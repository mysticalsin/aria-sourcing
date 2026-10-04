# Build spec — Apify LinkedIn profile-search source (`harvestapi/linkedin-profile-search`)

> Engineered from the vague prompt "add Apify… pull LinkedIn profiles… fully build it end to end."
> Model routing: **plan = Fable, execute = Sonnet** subagent. Grounded in the real MSourcing
> (`hermes-sourcing`) codebase and the real Apify actor + API contract (verified 2026-07-15).

---

## GOAL (atomic task)

Add **Apify** as a real, fourth sourcing/enrichment provider in MSourcing, alongside Apollo,
Sillage, and Seamless. The one wired actor is **`harvestapi/linkedin-profile-search`** ("LinkedIn
Profile Search Scraper — No Cookies"). A recruiter running a sourcing campaign enters LinkedIn
search criteria, the app runs the actor via the Apify API, and returns matching public profiles as
scored `Candidate` records into the campaign — reusing the existing scoring, dedupe, provenance,
and compliance-flag pipeline.

The token is **workspace-stored and encrypted** (provider `"Apify"` in the `api_keys` table),
entered through Settings → API Keys. **Never** put the token in `.env`, code, or the repo.

---

## HARD CONSTRAINTS

1. **Follow the house adapter pattern exactly.** Copy the shape of the async Sillage adapter, not a
   new invention. No new folders, no new conventions.
2. **Server-only secret.** The token is read only via `resolveStoredApifyKey(session)` using the
   service-role Supabase client + `decryptSecret`. It is never accepted from the client, never
   logged, never returned in a response. Errors are terse (`502`) and leak nothing.
3. **Async run pattern (start + status), mirroring Sillage.** Do NOT use the sync
   `run-sync-get-dataset-items` endpoint — it 408s at 300s and Vercel routes cap at `maxDuration:60`.
   Use: start run → poll status → fetch dataset items.
4. **RBAC + guards on every route**, identical to the Apollo/Sillage routes: `prodFailClosed()`
   first, then `checkRateLimit`, then (if `supabaseEnabled`) `auth.getUser()` → `current_profile_role`
   → `can(role,"source")`. Body validated with `validateBody(req, zodSchema, {maxBytes})`.
   `runtime = "nodejs"`.
5. **No schema migration.** Reuse `api_keys` (provider = `"Apify"`) and `workspace_state`. Sourced
   profiles become `Candidate` objects held in the store — same as every other provider.
6. **LinkedIn policy reconciliation is mandatory and must be coherent** (see the dedicated section
   below). The build is internally dishonest — and the honesty tests will fail — unless the
   integrations copy, the policy module, and the compliance flags are updated together.
7. **Minimal blast radius.** Touch only the files listed. No drive-by refactors. One logical change.
8. **Prove it works end to end** before declaring done (see Verification).

---

## THE REAL ACTOR CONTRACT (verified — do not re-guess)

**Actor:** `harvestapi/linkedin-profile-search` — no LinkedIn cookies/login required.
Pay-per-event: ~$0.10 / search page (Short), + $0.004 / full profile (Full).

**API base:** `https://api.apify.com/v2`. Auth: `Authorization: Bearer <token>` (preferred).

Async run lifecycle:
- Start: `POST /v2/actors/harvestapi~linkedin-profile-search/runs`  (note the `~` in the actor id)
  - body = the actor input JSON below
  - response `data.id` = runId, `data.defaultDatasetId` = datasetId, `data.status`
- Poll: `GET /v2/actor-runs/{runId}` → `data.status` in
  `READY | RUNNING | SUCCEEDED | FAILED | TIMED-OUT | ABORTED`
- Fetch results: `GET /v2/datasets/{datasetId}/items?format=json&limit=…`

**Actor input (map from the sourcing form — send only what's set):**
- `searchQuery` (string) — free-text / boolean
- `profileScraperMode` — `"Short"` | `"Full"` | `"Full + email search"` (default `"Short"`; gate
  `"Full + email search"` behind an explicit toggle because it costs more and pulls emails)
- `maxItems` (int) — cap results (enforce a sane server-side ceiling, e.g. ≤ 50 per run)
- `takePages` (int, ≤100), `startPage` (int)
- Filter arrays: `locations`, `currentJobTitles`, `pastJobTitles`, `currentCompanies`,
  `pastCompanies`, `schools`, `firstNames`, `lastNames`, `industryIds`, `seniorityLevelIds`,
  `companyHeadcount`, `companyHeadquarterLocations`, plus the matching `exclude*` arrays.

**Actor output item → `Candidate` mapping** (fields present on each dataset item):
- `linkedinUrl` → `Candidate.linkedinUrl`
- `firstName` + `lastName` → `Candidate.name`
- `headline` → title/headline; `about` → summary
- `location` (nested: `linkedinText`, `countryCode`) → location
- `currentPosition[]` (companyName, dateRange) → current role/company
- `experience[]`, `education[]`, `skills[]`/`topSkills` → techStack / enrichment
- `openToWork`, `hiring` → surface as signals / compliance-relevant flags
- `publicIdentifier` / `id` → external id for dedupe
- No email unless `"Full + email search"` mode → `Candidate.email` only then
- `sourcePlatform = "Apify"`, `sourceQuery = <the search criteria>`, set `provenance`
  (provider = Apify, actor id, runId, datasetId, retrievedAt) and `complianceFlags`.

---

## FILES TO CREATE / EDIT (exact paths)

**Create**
- `src/lib/sourcing/apify.ts` — adapter: typed input/output interfaces, `startProfileSearchRun`,
  `getRunStatus`, `fetchDatasetItems`, `checkApifyAuth`/`testApifyConnection`,
  `resolveStoredApifyKey(session)`. Use `AbortSignal.timeout(...)` on every fetch. Model on
  `src/lib/sourcing/sillage.ts`.
- `src/app/api/source/apify/start/route.ts` — validate criteria, resolve key, start actor run,
  return `{ ok, runId, datasetId }` or `{ ok:true, source:"not_configured" }` when no key.
- `src/app/api/source/apify/status/route.ts` — given runId(+datasetId), poll status; when
  `SUCCEEDED`, fetch items, map+score+dedupe, return `SourceResult`. Model on the Sillage pair.
- `src/components/candidates/source-apify-dialog.tsx` — criteria form (search query, location,
  titles, companies, maxItems, scraper mode). Gated on `can(role,"source")` AND a stored `"Apify"`
  key. Model on `source-sillage-dialog.tsx`; poll `status` on an interval with cancel + error states.
- Tests (`tests/*.mts`, tsx/node:test): `tests/apify-sourcing.mts` (adapter + mapping, fetch-stub),
  `tests/source-apify-auth.mts` (route guards/RBAC/prod-fail-closed via module mocks). Extend
  `tests/providers.mts`, `tests/integrations-honesty.mts`, `tests/linkedin-policy.mts`.

**Edit**
- `src/lib/types.ts` — add `"Apify"` to `SOURCE_PLATFORMS` (~L129) and to `API_KEY_PROVIDERS`
  (~L1053). Extend `Candidate.provenance` shape only if needed (prefer reusing existing fields).
- `src/lib/store/sourcing-helpers.ts` — add `mapApifyCandidates(items, query) → SourceResult`,
  reusing `scoreCandidate` and `dedupeCandidates`.
- `src/lib/providers.ts` — add `"Apify"` case to `validateApiKeyFormat` (Apify tokens look like
  `apify_api_…`; validate that shape, don't hardcode a key).
- `src/app/api/keys/test/route.ts` — add `else if (provider === "Apify")` → `checkApifyAuth`.
- `src/components/settings/api-keys-panel.tsx` — Apify appears automatically via `API_KEY_PROVIDERS`;
  add help text + the `apify_api_…` placeholder/format hint.
- `src/app/campaigns/[id]/page.tsx` — mount `<SourceApifyDialog/>` next to the other source buttons.
- `src/lib/integrations.ts` — flip/replace the LinkedIn/enrichment placeholder card to a truthful
  Apify card (`real:true`) describing "LinkedIn public-profile data via Apify (`harvestapi`)".
- `src/lib/linkedin-policy.ts` — see reconciliation below.
- `.env.local.example` — add a one-line comment that Apify is DB-stored (no env var), so nobody adds
  one. (No new env var.)

---

## ⚠️ LINKEDIN POLICY RECONCILIATION (blocking design decision)

`src/lib/linkedin-policy.ts` currently blocks, by design, the phrases `scrape linkedin`, `harvest
linkedin profiles` (`SUSPICIOUS_PATTERNS`), `phantombuster`, headless-browser-against-LinkedIn, etc.
`src/lib/integrations.ts` and the CSP assert the app does **no LinkedIn scraping / login-wall
bypass**, and `tests/integrations-honesty.mts` + `tests/linkedin-policy.mts` enforce that claim.
The actor is literally named `harvestapi`. **Adding a LinkedIn source without addressing this makes
the app internally dishonest and will fail the honesty tests.**

**Recommended resolution (encode this unless Tony overrides):**
Treat Apify as a **third-party data provider** in the exact same trust category as Apollo, Sillage,
and Seamless — which already surface LinkedIn URLs and profile-like data. The distinction the policy
actually protects is *the app never logs into LinkedIn, never uses the recruiter's LinkedIn
cookies/session, never drives a headless browser against linkedin.com*. This actor is "No Cookies" —
the app does none of those things; it buys indexed public-profile data from a vendor API. So:

1. Keep every FORBIDDEN pattern that targets **the app doing its own** automation/login/scraping.
2. Update the integrations copy + honesty tests to state the true posture:
   *"LinkedIn public-profile data is sourced via a compliant third-party provider (Apify
   `harvestapi`); the app performs no direct LinkedIn login, scraping, or session automation."*
3. Stamp every Apify-sourced candidate with a `complianceFlags` entry recording the third-party
   provenance and that consent/lawful-basis review is the recruiter's responsibility (GDPR — these
   are EU data subjects; the app is a French recruiting tool).
4. Do NOT relax the FORBIDDEN patterns to make a test pass. Change the *claim* to match reality,
   keep the *guardrail* against first-party scraping intact.

**Alternative (only if Tony rejects the above):** do not add a LinkedIn-profile source; wire the
Apify adapter generically and point it at a non-LinkedIn actor. This contradicts the stated goal.

---

## OUTPUT / ACCEPTANCE CRITERIA

- Recruiter with a stored Apify key + `source` permission sees an "Apify / LinkedIn search" button on
  a campaign; runs a search; gets scored, deduped candidates with LinkedIn URLs and provenance into
  the campaign. No key or no permission → button hidden; route returns `not_configured` / 403.
- Token never appears in any response, log, or the client bundle. Wrong/expired token → clean 502.
- Settings → API Keys accepts, format-validates, encrypts, and test-connects an Apify token.
- Integrations catalogue truthfully shows Apify as a real, enabled source.
- `npm run typecheck`, `eslint .`, and the full `npm test` suite pass — including the updated
  honesty and linkedin-policy tests. No test weakened to hide a real regression.

---

## VERIFICATION (Rule 5 — real proof, not "diff looks right")

1. `npm run typecheck` and `eslint .` clean.
2. New + existing tests green: `tests/apify-sourcing.mts`, `tests/source-apify-auth.mts`,
   `tests/providers.mts`, `tests/integrations-honesty.mts`, `tests/linkedin-policy.mts`,
   `tests/rbac-*.mts`, `tests/api-validation.mts`.
3. End-to-end against the real actor with a tiny cap (`maxItems: 3`, Short mode) using a token
   entered via the UI: start → poll → dataset items → mapped candidates land in the campaign.
   Capture the run output as evidence. (Spend is a few cents.)
4. Negative paths proven: missing key → `not_configured`; bad token → 502 (no leak); non-`source`
   role → 403; oversized body → 400.
5. Confirm the token is absent from `git grep`, server logs, and the client bundle.

---

## SECURITY NOTE (act on this)

The Apify token was pasted in plaintext in the prompt. Treat it as exposed: **rotate it in the Apify
console** and enter the new token only through Settings → API Keys (encrypted at rest via
`DATA_ENCRYPTION_KEY`). Do not commit any token anywhere.
