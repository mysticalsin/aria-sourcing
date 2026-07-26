# ARIA Sourcing — Architecture & Operations Guide

This document describes the sourcing experience as it is actually implemented in this
repository (MSourcing / ARIA) on `integration/sourcing-enrichment-on-main`
(HEAD `3ff4852`). Every claim below is grounded in a real file; line references point at
the code that backs the claim as of this commit and will drift as the code moves.

For the broader system map (agent runtime, outreach, deployment), see
[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md). This file goes one layer deeper on sourcing,
scoring, enrichment, and the candidate corpus specifically.

---

## 1. Overview

ARIA sourcing turns a job description into a scored, deduplicated candidate list, then
hands off to a human-approved outreach flow. The pipeline is:

```
JD intake → campaign → multi-provider discovery → deterministic scoring
  → cost-aware enrichment → approval-gated outreach handoff
```

Nothing sends itself. Every outbound message requires a recorded human approval
(`outreach_approvals`, `supabase/migrations/0006_outreach_approvals.sql:1-4` — the
migration's own header comment calls this "the human-approval gate ('never
auto-send')"). Sourcing and enrichment are read/discovery operations against public or
vendor-licensed data; nothing in this document authorizes automated messaging.

### Two-mode runtime

ARIA runs in one of two modes, decided centrally by `src/lib/supabase/config.ts:19`:

| Mode | Trigger | State & identity | Side effects |
|---|---|---|---|
| **DEMO** | No `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` | Synthetic seed data, browser `localStorage` (`src/lib/seed.ts`, `src/lib/store.ts`) | Dry-run only; no login gate |
| **LIVE** | Supabase env vars present | Supabase Auth + Postgres + RLS, normalized authority tables | Real provider calls and DB writes, gated by role/RLS |

Production **fails closed**: `assertSupabaseConfiguredInProd()` and `prodFailClosed()`
(`src/lib/supabase/config.ts:55-80`) throw / return `503` if `NODE_ENV=production` and
Supabase isn't configured — the app refuses to silently fall back into open DEMO
behavior (no login gate, implicit admin) in production. The one sanctioned exception is
`NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`, a deliberately public showcase deployment
(`config.ts:92-106`) that still keeps all outreach dry-run.

---

## 2. The sourcing pipeline

### Providers

| Provider | Platform id | Discovery mechanism | Key requirement | Notes |
|---|---|---|---|---|
| GitHub | `GitHub` | GitHub Users Search API, read-only | None — keyless by default (60 req/hr/IP anonymous, 5,000/hr with optional `GITHUB_TOKEN`) | `src/lib/sourcing/github.ts:1-17` |
| Web search (LinkedIn / Stack Overflow / Dribbble / Behance) | `LinkedIn`, `Stack Overflow`, `Dribbble`, `Behance` | `site:`-scoped Tavily web search, honest User-Agent, SSRF-guarded | Workspace-stored Tavily key, or `TAVILY_API_KEY` env fallback | `src/lib/sourcing/web-leads.ts:1-9`, `src/lib/ai/web-tools.ts:191-256` |
| Apify — profile search | `Apify` | `harvestapi~linkedin-profile-search` actor, async run + poll + dataset fetch | Workspace-stored Apify key | `src/lib/sourcing/apify.ts:1-25`; supports `firstNames`/`lastNames` as explicit search filters (§below) |
| Apollo | `Apollo` | Free `mixed_people/search`, then a paid `people/match` for email/phone | Workspace-stored Apollo key | `src/lib/sourcing/apollo.ts`, receipt-ledgered via `src/lib/sourcing/source-authority.ts` |
| Seamless.AI | `Seamless` | Free search + async paid research/poll | Workspace-stored key | **Production-disabled by design** (see below) |
| Sillage | `Sillage` | Company-domain account mapping, async | Workspace-stored key | **Production-disabled by design** (see below) |

All provider keys except `GITHUB_TOKEN` and the Tavily env fallback are entered via
**Settings → API Keys**, encrypted at rest, and never sent to the browser
(`validateApiKeyFormat` in `src/lib/providers.ts:18-37` does client-safe format checks
before the key is even submitted).

**The Apify profile-search filter (commit `3c29b23`, extended `25b65de`).** The
`harvestapi/linkedin-profile-search` actor input accepts structured filters —
`locations`, `currentJobTitles`, `pastJobTitles`, `currentCompanies`, `pastCompanies`,
`schools`, and (since `25b65de`) `firstNames`/`lastNames`
(`src/lib/sourcing/apify.ts:38-52`). The `firstNames`/`lastNames` pair was backend-ready
since the initial Apify integration but UI-hidden until `25b65de` wired it into the
source dialog (`src/components/candidates/source-apify-dialog.tsx:47-134`, validated
server-side at `src/app/api/source/apify/start/route.ts:34-48`). This is what lets a
recruiter resolve one *specific* named person (e.g. "find exactly this candidate's
current profile") instead of only running a broad boolean search.

**Seamless/Sillage are production-disabled by design**, not by accident:

```ts
// src/lib/supabase/config.ts:33-39
// Sillage and Seamless do not yet have the server-owned receipt authority used
// by Apollo. They remain available only for explicit local development and
// can never be enabled in a production build.
export const experimentalPaidSourcingEnabled =
  !isProduction && process.env.NEXT_PUBLIC_ENABLE_EXPERIMENTAL_PAID_SOURCING === "true";
```

Apollo has a server-owned claim/receipt ledger (`prepare → claim → complete/ambiguous →
reconcile → erase`, `src/lib/sourcing/source-authority.ts:152-488`, backed by RPCs like
`prepare_apollo_enrichment`/`claim_apollo_enrichment`) that makes a paid spend
idempotent, auditable, and erasure-safe. Seamless and Sillage don't have that authority
layer yet, so their discovery/enrichment paths are gated off entirely in a production
build (`isProduction` check, not just a feature flag) — keys alone won't turn them on in
prod. This is the same design principle the enrichment orchestrator's runners inherit
(§4).

### Discover → map → score → dedupe → commit

The canonical path (the DeerFlow-reviewed sourcing-agent flow,
`src/lib/store/sourcing-actions.ts:735-782`) runs:

1. **Discover** — a provider adapter returns raw results (GitHub users, web-search hits,
   Apify/Apollo profiles).
2. **Map** — `candidateFromSourcingAgentDto` / the platform-specific mapper
   (`src/lib/sourcing/candidate-mappers.ts`) normalizes raw provider data into the
   `Candidate` shape.
3. **Score** — `scoreCandidate(candidate, campaign.jobAnalysis, weights)`
   (`src/lib/store/sourcing-actions.ts:750`) computes the 6-dimension composite (§3).
4. **Dedupe** — `dedupeCandidates(scored, previous.candidates, …)`
   (`src/lib/store/sourcing-actions.ts:757`, `src/lib/rules.ts:233`) drops anything that
   collides with an existing candidate or falls inside the recontact window.
5. **Commit** — the accepted, scored, deduped batch is written into the live workspace
   document / DB inside one `commitPersisted` transaction.

(One helper, `candidate-mappers.ts`'s `scoreAndDedupe`, runs the last two steps in the
opposite order — dedupe before score — for the direct web-lead mapping path. Functionally
equivalent for de-duplication purposes; the sourcing-agent path above is the primary,
reviewed flow.)

### Dedupe keys and the 90-day recontact window

`dedupeCandidates` (`src/lib/rules.ts:233-294`) rejects an incoming candidate on the
first key that collides with an existing one, checked in this order:

1. Non-blank **email** (case-insensitive)
2. **LinkedIn URL** (case-insensitive)
3. **GitHub URL** (case-insensitive)
4. **Source URL** (case-insensitive — catches Stack Overflow/Dribbble/Behance profiles
   with no dedicated URL field)
5. **Excluded company** (`campaign.sourcingStrategy.excludedCompanies`)
6. **Current/hiring company** match
7. **Recontact window**: `daysSince(cand.lastContactedAt) < DEDUPE_WINDOW_DAYS`

```ts
// src/lib/rules.ts:16-17
export const MIN_SCORE_FLOOR = 70;
export const DEDUPE_WINDOW_DAYS = 90;
```

A blank email is never treated as a dedupe key (`rules.ts:254-256`) — real sourced
profiles (GitHub, in particular) frequently have no public email, and two candidates
with no email shouldn't collide on that absence.

---

## 3. Signal-aware scoring

`src/lib/scoring.ts` (migration-era commit `bc31d54`, "signal-aware composite — exclude/
anchor no-signal dimensions") is the deterministic scorer. It replaced a version that
silently scored every dimension even when the candidate had no data for it — which
fabricated a midpoint value (usually ~50) for roughly a third of the composite on a
typical candidate.

### The six weighted dimensions

```ts
// src/lib/scoring.ts:9-16
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  skills: 34,
  experience: 22,
  companyStage: 12,
  industry: 12,
  location: 10,
  activity: 10,
};
```

| Dimension | Default weight | What it measures |
|---|---|---|
| Skills match | 34 | Overlap of `techStack` against `requiredSkills`/`niceToHaveSkills` |
| Experience fit | 22 | `yearsExperience` vs. the JD's min/max band |
| Company-stage fit | 12 | Overlap with `companyStageTarget` (Seed → Public) |
| Industry overlap | 12 | Overlap with `industryExperience` |
| Location & timezone | 10 | Region/timezone match, remote-aware |
| Signal & activity | 10 | Recency/strength of public activity signal (commits, posts, etc.) |

### The three-state model

Each dimension is classified into one of three states before it's allowed to contribute
to the composite (`classifyDimensions`, `scoring.ts:199-275`):

- **`scored`** — the candidate has real data for this dimension; the dimension's own
  scoring function runs normally.
- **`not_applicable`** — the *role* never asked for this signal (e.g. no
  `minYearsExperience`/`maxYearsExperience` on the JD, so "Experience fit" is excluded
  entirely rather than scored against nothing).
- **`unknown`** — the role *did* ask, but the candidate's value is missing. Rather than
  score this as an invented midpoint, it's anchored to a fixed low-confidence value:

```ts
// src/lib/scoring.ts:27
const UNKNOWN_ANCHOR = 30;
```

### Composite = sum of contributions

```ts
// src/lib/scoring.ts:289-311
const applicable = SCORE_DIMENSIONS.filter((key) => dims[key].state !== "not_applicable");
const denom = applicable.reduce((sum, key) => sum + effectiveWeight(weights, key), 0);

const breakdown = SCORE_DIMENSIONS.map((key) => {
  const dim = dims[key];
  const excluded = dim.state === "not_applicable" || denom === 0;
  const weight = excluded ? 0 : effectiveWeight(weights, key) / denom;
  const effectiveScore = dim.state === "unknown" ? UNKNOWN_ANCHOR : dim.score;
  const contribution = excluded ? 0 : effectiveScore * weight;
  return { key, score: round(clamp(...)), weight: round(weight, 3), contribution: round(contribution, 1), rationale: dim.rationale };
});
const composite = breakdown.reduce((sum, item) => sum + item.contribution, 0);
```

- **`not_applicable`** dimensions are excluded from both the weight denominator and the
  sum — the remaining applicable dimensions are re-normalized to fill the full 100 points
  (a role with no experience band, no stage target, and no industry preference still
  scores out of 100 using only skills/location/activity).
- **`unknown`** dimensions stay in the denominator (they *were* requested) but contribute
  at the fixed `UNKNOWN_ANCHOR = 30` rather than their raw computed score, so a missing
  signal always drags the composite down instead of landing at a flattering ~50-70
  fabricated midpoint.
- Every dimension's `rationale` string is preserved in the returned `breakdown`
  (`MatchBreakdownItem[]`) so the UI can render an honest, per-dimension "why this score"
  explanation — including `UNKNOWN_RATIONALE = "Requested but candidate value unknown -
  counted as unverified."` (`scoring.ts:47`) for anchored dimensions.

The net effect: roughly a third of the composite that used to be fabricated
midpoint noise on a typical sparse candidate is now either honestly excluded
(role didn't ask) or honestly penalized (role asked, data's missing) — never silently
invented.

---

## 4. Enrichment

`src/lib/enrichment/*` (commit `8bda068`, "unified multi-provider enrichment
orchestrator"; commit `acd69a9`, "home experience/education/languages instead of
discarding them") is the cost-aware waterfall that fills in missing candidate fields
after discovery.

### Cost-ascending waterfall

`orchestrateEnrichment` (`src/lib/enrichment/orchestrator.ts:105-191`) is server-only. It:

1. Filters `ENRICHMENT_PROVIDERS` (`src/lib/enrichment/registry.ts:59-116`) to those that
   (a) can fill at least one wanted field, and (b) can resolve an identity key for this
   specific candidate (`provider.keyField(candidate) != null`).
2. Sorts the eligible providers **cheapest-first**:

   | Provider | `costUnits` | Fills |
   |---|---|---|
   | Apify (dev_fusion, LinkedIn full profile) | 1 | email, headline, skills, experience, education, languages, location |
   | Apollo | 2 | email, phone |
   | Seamless.AI | 3 | email, phone |
   | Sillage (account mapping) | 4 | email, phone, headline, location |

3. Runs each provider in turn until the wanted fields are covered, the caller's
   `budgetRemaining` (cost-unit budget) hits zero, or a **45-second wall-clock deadline**
   (`ORCH_DEADLINE_MS = 45_000`, `orchestrator.ts:22`) is reached — kept comfortably under
   the platform's 60s route cap so a request never 504s and strands an already-spent
   cheap-provider result.
4. Slow async pollers (Seamless research, Sillage account mapping,
   `POLL_BUDGET_MS = 30_000`) get a pre-flight runway check before starting — a provider
   that can't finish its own worst-case poll within the remaining deadline is recorded as
   `"deferred"` and simply not started, rather than run into the cutoff mid-poll.
5. **Cross-provider identity resolution** is the core design principle: every provider
   resolves its *own* identity from the candidate's universal fields (name, company,
   `linkedinUrl`, `externalIds`) via its own free search/lookup step, so a candidate
   discovered by GitHub can still be enriched by Apollo, and vice versa
   (`registry.ts:11-17`).
6. On completion, if a `JobAnalysis` was supplied, the candidate is re-scored
   (`scoreCandidate`, `orchestrator.ts:185-188`) — enrichment can move a candidate's
   composite once real skills/experience/location data replaces an `unknown` anchor.

### Per-field provenance + coverage

`mergeEnrichment` (`src/lib/enrichment/merge.ts:199-240`) folds one provider's results
into the candidate field-by-field:

- A scalar field (`email`, `phone`, `headline`, `location`, `company`) is only overwritten
  if the candidate currently lacks it, **or** the new result's `confidence` beats the
  confidence already on record (`merge.ts:209-219`) — a missing confidence on either side
  defaults to `0`, so a confident new value can overwrite an unconfident stored one, but
  never the reverse.
- `skills` is a **union field** (`UNION_FIELDS`, `merge.ts:58`) — it always attempts to
  merge additively, case-insensitively de-duped, rather than gating on "already present."
- Every accepted field gets `{ provider, at, confidence }` recorded in
  `enrichment.fieldProvenance` (`merge.ts:225`) — so the UI (and any later audit) can show
  *which provider* supplied *which value* and *when*.
- `computeCoverage(candidate)` (`merge.ts:110-112`) derives "fields currently present"
  live off the candidate for homed fields, and off recorded provenance for the rest —
  this is what the orchestrator uses to decide a field is already covered and skip
  querying for it again.
- `CandidateEnrichment.status` ladders `unenriched → partial → enriched` based on whether
  the common fields (`email`, `phone`) are both covered (`deriveStatus`, `merge.ts:114-117`).

### Experience/education/languages are now homed, not discarded

Before `acd69a9`, Apify's rich `experience`/`education`/`languages` payload had nowhere
to live on `Candidate` — only the fact that a provider *supplied* them was tracked via
provenance, and the actual string arrays were dropped. That's fixed: `Candidate` now
carries dedicated optional slots —

```ts
// src/lib/types.ts:382-386
experience?: string[]; // "Title @ Company (dates)", newest first — free text, never parsed into yearsExperience
education?: string[];  // "Degree @ School (dates)"
languages?: string[];  // spoken/written languages
```

— and `merge.ts`'s `HOMED_FIELDS` set (`merge.ts:41`) plus `applyFieldValue`
(`merge.ts:160-169`) read/write them like any other homed field. The Apify runner
(`enrichment/runners.ts:125-133`) formats each experience/education entry as
`"Title @ Company (dates)"` / `"Degree @ School (dates)"` from the raw actor payload.
Deliberately **not** parsed into `yearsExperience` — that field carries its own
fabrication contract (`types.ts:387-389`: "Null means not provided and must never be
rendered or scored as zero years") and free-text date ranges from a scraped profile
aren't reliable enough to compute a number from.

(One stale artifact: `merge.ts`'s module-header comment, lines 8-22, still describes
these three fields as having "NO dedicated slot on Candidate today" — that comment
predates `acd69a9` and should be treated as outdated; the code below it (`HOMED_FIELDS`,
`readHomedValue`, `applyFieldValue`) is the current, correct behavior.)

---

## 5. The candidate corpus (migrations 0035 / 0036 / 0037)

The workspace's JSONB document (`workspace_state.state->'candidates'`) remains the
single **authoritative** write path for candidates — nothing about the corpus changes
where a client writes. The corpus is a read-side compounding foundation layered on top.

### The shadow `candidates` table (0035)

`supabase/migrations/0035_candidate_corpus_mirror.sql` creates a normalized
`public.candidates` table and populates it entirely via **database triggers** —
`candidates_corpus_mirror_ins`/`_upd` fire after every insert/update to
`workspace_state` and call `sync_candidates_corpus()`
(`0035_candidate_corpus_mirror.sql:235-245`), which flattens
`new.state->'candidates'` into rows. **Zero client change**: no app code calls this table
directly to write; every existing sourcing/scoring/enrichment code path above continues
writing the JSONB document exactly as before, and the mirror just happens.

The table is locked down hard: RLS is force-enabled, all grants revoked from
`public/anon/authenticated/service_role/authenticator`, and the only policy grants
access to `postgres, supabase_admin` (`0035:45-51`) — this table is not directly
product-readable by a tenant session; it exists purely as raw material for the read RPC
below and future corpus consumers (embeddings, redeployment).

Erasure-safety is built into the same trigger: the mirror sync query filters out any
candidate whose id matches a `candidate_erasure_suppression_tombstones` row before
inserting (`0035:164-174`), and a dedicated
`cleanup_erased_candidate_mirror()` trigger on `candidate_erasure_requests` deletes the
mirrored row the moment an erasure request lands with any non-`blocked_legal_hold`
status (`0035:247-271`).

### The tenant-isolated read path (0036)

`0036_candidate_corpus_read.sql` adds:

- `list_workspace_candidates(campaignId, stage, source, search, sort, limit, offset)` —
  a `security definer` RPC that **checks `auth.uid()` and resolves
  `current_workspace_id()` itself** (`0036:255-262`) rather than trusting a caller-passed
  workspace id, so cross-tenant reads are impossible even with a crafted argument. Only
  `authenticated` has `execute` (`0036:313-314`); everyone else's grant is explicitly
  revoked.
- `backfill_candidates_corpus()` / `mirror_workspace_candidates()` — the same mirroring
  logic as the trigger, callable directly for backfilling pre-existing workspaces (the
  migration ends by calling `backfill_candidates_corpus()` for itself, `0036:316`).

The app-facing surface is `GET /api/candidates` (`src/app/api/candidates/route.ts`),
which fails closed the same way as every other production route
(`prodFailClosed()` first, then `supabaseEnabled` check, then session/role check via
`can(role, "view")`) before calling the RPC, and is gated by a **preview flag**:

```ts
// src/lib/supabase/config.ts:41-44
/** Preview-only: read /candidates listing rows from the server corpus mirror.
 *  Default off keeps the existing store-backed page path unchanged. */
export const corpusServerReadEnabled =
  process.env.NEXT_PUBLIC_ENABLE_CORPUS_SERVER_READ === "true";
```

Default off — the existing store-backed `/candidates` page keeps working unchanged until
this flag is explicitly turned on (`src/app/candidates/page.tsx:147`).

### The person model (0037)

`0037_person_identity_model.sql` adds a derived identity layer *over* the candidate
corpus: `public.persons` (one row per resolved real person) and
`public.candidate_identities` (identity keys pointing at a person).

Linkage is **deliberately conservative**: the only identity key today is a canonical
LinkedIn personal-profile URL —

```sql
-- 0037_person_identity_model.sql:82-84
if p_candidate.linkedin_url is not null
   and btrim(p_candidate.linkedin_url) ~* '^(https?://)?(www\.)?linkedin\.com/in/[^/?#]+/?(\?.*)?$' then
  v_key := lower(btrim(p_candidate.linkedin_url));
```

— i.e. `/in/...` profile URLs only, byte-for-byte canonicalized the same way the 0033
erasure tombstones are. Anything else (name-only match, email match) is out of scope for
now — an ambiguous match (more than one existing identity row for the same normalized
URL) is treated as **no link** rather than a guess (`0037:135-145`).

`link_candidate_person()` is a trigger on `public.candidates` (fires after insert/update
of `linkedin_url`) that calls `link_one_candidate()` to resolve or create the person row
and record the identity — this is how a candidate sourced under two different campaigns
(or re-sourced weeks later) still resolves to the same `person_id`.

**Fail-closed erasure GC**: `link_one_candidate()` re-checks the same erasure tombstone
table before linking (`0037:102-126`, with a documented STABLE-function hoisting guard so
the check only fires when tombstones actually exist for the workspace) — a direct-DB
attempt to relink a previously-erased LinkedIn identity is blocked as defense-in-depth,
even though the migration's own analysis (`0037:297-307`) argues the normal erasure path
already makes this unreachable in practice. `gc_deleted_candidacies()`
(`0037:245-289`) is a statement-level trigger that removes now-orphaned
`candidate_identities`/`persons` rows whenever a candidacy is deleted, so the person
layer never accumulates dangling identities.

### Framing

This is explicitly a **foundation**, not a finished feature: the shadow table, the
tenant-isolated read RPC, and the person-identity layer exist so that a future server-side
pipeline (embeddings over the corpus, cross-campaign candidate reuse, "redeployment" of an
already-sourced person into a new role) has a normalized, RLS-safe, erasure-consistent
place to read from — without ever having touched how or where a client writes a
candidate. None of embeddings, a server-side sourcing pipeline, or automated
redeployment exist yet; `corpusServerReadEnabled` gates even the read-only listing
endpoint off by default.

---

## 6. Compliance & safety

| Control | Mechanism | Where |
|---|---|---|
| Never-auto-send | DB table `outreach_approvals`, keyed to the exact message body hash; send route refuses without a matching row | `supabase/migrations/0006_outreach_approvals.sql:1-4` |
| App-level approval gate | Score floor, personalization evidence, do-not-contact/unsubscribed/suppressed checks, per-channel contact-info and rate-limit checks | `checkOutreachApproval`, `src/lib/rules.ts:52-160`+ |
| Multi-tenancy | Row-Level Security on every workspace-scoped table; force-RLS on the corpus mirror and person tables | `0035:45-46`, `0037:28-31` |
| GDPR erasure | Legal-hold-aware, idempotency-keyed erasure transaction scrubbing every candidate-addressable store; tombstones drive corpus-mirror and person-linkage suppression | `0033_candidate_erasure_authority.sql`, extended by `0035`/`0037` |
| Lawful basis capture | Operator-recorded `consent` / `legitimate_interest` basis with source + timestamp, required before outreach approval on any manually-entered candidate | `src/lib/candidate-lawful-basis.ts`, enforced in `rules.ts:84-97` |
| Field provenance | Per-field `{ provider, at, confidence }` on every enriched value | `src/lib/enrichment/merge.ts:225` |
| Discrimination-proxy filter | Provider-backed sourcing egress requires a `ProviderClearance`; discovery clearances are minted only after every submitted criteria field is checked for protected-class terms (age/gender/race/religion/disability/marital/nationality/university-graduation wording) and the search is bound to the approved role's own JD terms | `src/lib/sourcing/query-policy.ts`, `src/lib/sourcing/provider-egress.ts` |
| LinkedIn policy | This app never logs into, scrapes, or automates LinkedIn itself; LinkedIn data comes from a licensed vendor API (Apify); LinkedIn *outreach* is assisted-manual only (draft → human copy/paste/send) | `src/lib/linkedin-policy.ts:1-89` |

**Erasure request lifecycle** (`0033_candidate_erasure_authority.sql`): a request binds
an exact workspace + campaign + candidate + administrator + idempotency key, blocks on
an active legal hold (`candidate_legal_holds`), scrubs every candidate-addressable
operational store, and records only row counts plus opaque provider-reference hashes.
External provider-side deletion is never assumed complete — unsupported provider work is
left `manual_required` until independently closed by an operator. `0035` and `0037`
extend this same tombstone mechanism to the corpus mirror and the person-identity layer,
so an erased candidate can't resurface through either.

**Lawful basis**: `recordedCandidateLawfulBasis()` only returns a basis when all three of
`lawfulBasis` (`"consent"` | `"legitimate_interest"`), `lawfulBasisSource ===
"operator_selection"`, and a canonically-formatted `lawfulBasisRecordedAt` timestamp are
present (`src/lib/candidate-lawful-basis.ts:17-29`) — a partially-filled record is treated
as no basis at all, and `checkOutreachApproval` blocks outreach to a manually-entered
candidate without one.

---

## 7. Operating it

### Key environment variables and flags

| Variable | Effect |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Presence switches the app from DEMO to LIVE mode (`supabase/config.ts:15-19`) |
| `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` | Sanctioned public-demo exception to the prod fail-closed rule; outreach stays dry-run regardless |
| `NEXT_PUBLIC_ENABLE_EXPERIMENTAL_PAID_SOURCING` | Combined with a non-production build, unlocks Seamless/Sillage locally — never in prod |
| `NEXT_PUBLIC_ENABLE_CORPUS_SERVER_READ` | Preview flag for the `/api/candidates` server-corpus read path; default off |
| `GITHUB_TOKEN` | Optional; raises GitHub Users Search API from 60 to 5,000 req/hr — never required |
| `TAVILY_API_KEY` | Server-side fallback for web-search sourcing when no workspace Tavily key is stored |
| Apify / Apollo / Seamless / Sillage keys | Entered via Settings → API Keys, encrypted at rest, never env vars |

### Fly topology (as deployed)

```
Internet
  -> aria-mantu-app         (Next.js)
  -> aria-mantu-kong        (API gateway)
       -> aria-mantu-auth   (self-hosted Supabase Auth/GoTrue)
       -> aria-mantu-rest   (PostgREST)
            -> aria-mantu-db (Postgres)

aria-mantu-bootstrap  -> privileged reconciliation + ordered migrations, exits after
```

Five long-running Fly services plus a one-shot migration/bootstrap app — self-hosted
Supabase, not the managed Supabase cloud (`docs/ARCHITECTURE.md:184-200`).

### Running one role end to end

1. **Intake** — recruiter enters a job description; ARIA parses it into a `JobAnalysis`
   (required/nice-to-have skills, experience band, company-stage target, industry,
   regions) and a campaign is created.
2. **Source** — the recruiter triggers one or more providers from the campaign page
   (GitHub / web-search / Apify / Apollo, gated by `campaignAllowsLiveSourcing(status)`
   and, in prod, further gated off for Seamless/Sillage). Each run discovers → maps →
   scores → dedupes → commits into the campaign's candidate list.
3. **Review** — candidates land sorted by match score, each with a rationale-annotated
   breakdown (§3) so a low score is explainable, not just a number.
4. **Enrich** — for a shortlisted candidate missing contact info, the recruiter (or an
   automated post-source step) runs the enrichment waterfall (§4); email/phone/skills/
   experience get filled in cheapest-provider-first, and the candidate is re-scored.
5. **Draft** — an outreach draft is generated with personalization evidence attached.
6. **Approve** — a human reviews and approves the exact draft; the approval is recorded
   against the exact message body hash.
7. **Send** — only now does `/api/outreach/send` deliver (email via Resend/SendGrid;
   WhatsApp via signed webhook adapters, currently dry-run pending Meta WABA
   provisioning; LinkedIn is always assisted-manual copy/paste).
8. **Reply / schedule** — inbound replies are classified and routed to a human-review
   queue; a durable calendar-booking authority (commit `99419a1`) handles interview
   proposals with a fail-closed claim ledger.

### Current owner-gated items

These require Tony personally (credentials, account approval, or a deliberate spend
decision) — compiled from `_relay/2026-07-16-owner-actions.md`:

| Item | What it unlocks | Action |
|---|---|---|
| **dev_fusion Apify actor approval** | The secondary LinkedIn profile enricher used by the enrichment waterfall (currently returns `403 full-permission-actor-not-approved`, surfaced gracefully as `not_configured`) | One click in the Apify console — approve the actor's permissions |
| **Apollo / Seamless / Sillage API keys** | The full cost-ascending enrichment waterfall beyond Apify | Enter via Settings → API Keys (Seamless/Sillage still won't run in prod without the receipt-authority work described in §2) |
| **GitHub Actions budget** | CI/CodeQL — every job currently fails at startup with "Actions budget…" | Raise the spending limit / add payment in GitHub billing |

harvestapi (the primary Apify discovery actor) already covers discover + enrich + email
on its own without the dev_fusion approval — that approval only unlocks the *secondary*
enricher in the cost-ascending waterfall.

---

## Section index

1. Overview — two-mode runtime, fail-closed production posture
2. The sourcing pipeline — providers, discover→map→score→dedupe→commit, dedupe keys, 90-day recontact window
3. Signal-aware scoring — six dimensions, three-state model, `UNKNOWN_ANCHOR`
4. Enrichment — cost-ascending waterfall, per-field provenance, homed experience/education/languages
5. The candidate corpus — shadow mirror, tenant-isolated read RPC, person-identity model
6. Compliance & safety — never-auto-send, RLS, GDPR erasure, lawful basis, discrimination-proxy filter, LinkedIn policy
7. Operating it — env/flags, Fly topology, end-to-end run, owner-gated items
