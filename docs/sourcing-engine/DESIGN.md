# Aria sourcing-engine contract

Product: **Aria**. A recruiter puts a client **need** in; Aria returns a scored
shortlist of people who can win that need.

Calypso is a **need** — a capital-markets trading-platform role — not a product
name, not a person, and not a brand for this app, PR, UI, or copy. Do not name
anything "Aria Calypso".

This file is the contract. Implementation follows it. UI does not define it.

## Need

A need is a structured hiring brief Aria understands from one of two inputs:

1. **Paste or upload** a job description (plain text, Mantu VSS Recruitment
   Need — line-oriented `Label` / `value` or `Label: value` — or a PDF/CV
   whose text is recovered by OCR).
2. **Inbound email** already connected to Aria (Mantu "need is now ACTIVE"
   shape, a VSS paste in the email body, or a generic JD email).

Required fields after parse:

| Field | Meaning |
| --- | --- |
| `title` | Role title as stated |
| `requiredSkills` | Tools, platforms, and skills the need actually asks for. Product platforms (Calypso, Murex, Summit, …) are **skills**, never candidate names. |
| `niceToHaveSkills` | Optional skills |
| `experienceSignals` | Phrases that must appear as **work** (CV / LinkedIn / other), e.g. "Calypso implementation", "trade capture", "FO/BO" |
| `minYearsExperience` | Numeric band when stated; otherwise null |
| `industry` | Domain, e.g. capital markets |
| `source` | `paste` \| `email` \| `upload` |
| `rawText` | The recovered source text (capped) |

A parse that cannot extract at least one required skill is not a need. Aria
does not invent a brief.

A complete VSS parse (title + seniority + employment + location type + at
least one required skill) is **evidence**. The cloud parser must not replace
it, shrink the Skill (Must) list, or leave the brief empty. Intake keeps the
existing paste shape (recruiter email/brief + optional JD, `POST /api/intake`).

**Skill (Must) is tokenized on spaces** (and commas/semicolons), keeping
known phrases such as `Linux Server`. One chip
`Linux Python Shell Oracle Grafana Dynatrace Linux Server` is a parse fail:
GitHub `language:LinuxPython…` and a LinkedIn AND of that blob have zero
recall. After tokenize, intake must recover Middle 4–6 years → `Mid` min 4
max 6, Montreal, Hybrid, and English when the VSS states them.

The fixture pool proves the matcher in tests and `POST /api/source/need?mode=fixture`
only. Talent Pool and Fly never present lab fixtures (`@fixture.example`) as
candidates. Aria does not dress a fixture as a live person.

## Evidence (what a candidate is scored on)

A candidate is scored only on three evidence channels:

1. **Skill set** — tools and platforms attested in CV / resume / LinkedIn /
   other profile text. Never from the display name.
2. **CV / resume experience** — roles, tenure, products implemented, recovered
   from uploaded or stored CV text (OCR when the file is a PDF).
3. **LinkedIn (or other) experience** — headline, positions, about.

The candidate's **display name is not evidence**. Before any match, Aria
strips name tokens from every evidence haystack.

Empty evidence (no skills, no CV text, no LinkedIn/other experience) is a
**FAIL**. Score is 0. The candidate cannot enter the shortlist.

## Name-match forbidden

A need token (example: the string "Calypso") that appears **only** as a
person's name is a name-only hit.

- Name-only hits are **ineligible**.
- Their score must not pass the 60% floor.
- Ranking someone because they are named Calypso is a contract violation.

People-first shortlist rows must be **real people with email, phone, and LinkedIn**.
Keep extra harvest fields when present. Do not invent contact fields.
Leftover GitHub / `@example.com` / `@fixture.example` rows are **FAIL**.
Name-only is **FAIL**. Live hydrate strips those leftover rows from
people-first campaigns. A valid stored Apify key plus a reviewed
Calypso brief must reach `request_entry` — leftover GitHub rows or a
strict projection miss must not toast Open Access & Keys. If harvestapi
Full returns people without email + phone + LinkedIn, fail loud
(`PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS`) with query + run-id. Do not
keep those rows.

## Score

```
skillsWeight      = 0.50
cvWeight          = 0.30
linkedinWeight    = 0.20

skillsScore       = requiredHits/required * 80 + niceHits/nice * 20   (0–100)
cvScore           = experience-signal coverage on name-stripped CV text (0–100)
linkedinScore     = experience-signal coverage on name-stripped LinkedIn/other text (0–100)

composite         = round(skillsScore*0.50 + cvScore*0.30 + linkedinScore*0.20)
```

Missing a channel scores 0 for that channel (no default 70–75 inflation).
Years-in-band can lift `cvScore` only when CV text also contains at least one
experience signal; years alone are not a win.

**Floor:** 60. Below 60 is not shortlisted.
**Cap:** 20. Return at most 20 people.
**Rank:** higher composite first. Higher score = higher chance to win the need.

## Shortlist result

```
{
  need: SourcingNeed,
  shortlist: [{ id, name, score, breakdown, evidence, provenance }],  // 0–20, all score >= 60
  rejected:  [{ id, name, score, reason }]   // name_only | empty | below_floor
}
```

`evidence` is per-row citations, not a campaign blurb:

```
{ skills: string[], cv: string[], linkedin: string[] }
```

Each array is readable snippets around that channel's hits in the original
skill list / CV / LinkedIn (or other) text. Every shortlisted row must carry
at least one CV citation. Empty and name-only rows have empty arrays.

`provenance` is `fixture` or `live`. Live rows come from a real provider
response. Aria never invents a live person and never dresses a fixture as live.

Clustered synthetic scores (two buckets, a flat 75, or 12×80 then 4×63) are a
Fly fail. Shortlist scores must spread from distinct skill / CV / LinkedIn
coverage.

## Providers

Aria searches the web for people who **have the skills**. It is not
LinkedIn-only and not a GitHub-`language:` hack for product platforms
(Calypso is a skill, never `language:Calypso` or a concatenated
`language:LinuxPython…` token). GitHub queries use the same Skill (Must)
tokens as chips — `language:Python` / `language:Shell` or topic terms, never
one glued word. LinkedIn boolean uses the same tokens as `"Linux" OR "Python"`,
never one quoted Skill (Must) phrase. A stale persisted blob is repaired on
hydrate and on the Strategy tab.

- **LinkedIn is a primary source** (resumes, experience, skill-word search)
  when official partner search is connected. Official LinkedIn partner
  search is **not wired**. Aria is **not** LinkedIn-only: Apify plus other
  keyed sources (GitHub, Talent Pool, Seamless, Sillage, Apollo) still run.
  GitHub `language:` is only for real programming languages (Python,
  Shell, …). A Tavily `site:linkedin.com` web search is **not** the
  people-first harvest and must not consume the harvest budget before
  harvestapi finishes.
- **Trading-platform / finance needs** (Calypso, Murex, application support)
  run the **wired Apify harvest first**. The LinkedIn boolean stays on the
  plan for when official LinkedIn is connected; it is not the harvestapi
  query and is not executed before Apify.
- **Connect LinkedIn in the product** via official OAuth / Recruiter System
  Connect / a licensed vendor API. Fail closed without credentials. Do not
  scrape, do not automate a personal login, do not read a local LinkedIn
  export folder.
- **Outreach campaigns are in-product.** After Source next batch / Run
  sourcing agent, Aria drafts first-touch for shortlisted people (score ≥ 60,
  cap 20) into Needs Approval. That is the HeyReach-style campaign: the
  agent builds the sequence and targets the shortlist. Messaging stays
  dry-run until a human approves the first send; never auto-send; never
  identify as AI in copy (`gateOutbound` blocks AI disclosure). After that
  first approval, follow-ups stay in-product (`draftFollowUpFor`). The old
  HeyReach “0 LI accounts” HOLD is not a skip — campaigns live here now.
- **Fixture / demo path** may prove the matcher (need in → scored shortlist
  out) without network I/O.
- **Live path** uses configured providers (Apollo / Sillage / Seamless / Apify
  / LinkedIn / GitHub) when their keys exist. Source next batch for
  people-first roles (finance / trading-platform / application support)
  always runs a **recall-capable Apify harvestapi search** even when a
  cloud model is configured. It does not GitHub-only a Calypso need and
  does not add GitHub steps unless the role's platforms include GitHub.
  A cloud model may draft outreach after those searches; it cannot
  replace them with `language:` blobs.
- **Keyed people-first harvest is the product.** Empty harvest is not a
  product result. Aria can never find 0 people. When a valid Apify key
  is already Connected, Source next batch on **Calypso Application
  Support** must return **real people**, then a skill-match shortlist
  (score ≥ 60, cap ≤ 20). It must not be 0-or-toast. Do not invent
  candidates. Do not dress fixtures as live.

  Harvest query (harvestapi `searchQuery`) is keywords, not a LinkedIn
  boolean and not `title + first six Skill (Must) tokens` jammed as AND.
  The recall shape is the distinctive platform from the need (Calypso
  is a **need** / skill, never a person) plus two must-have skills —
  the same shape that already works in Source via Apify
  (`Calypso Linux Python`). A Senior Calypso Business Analyst searches
  `Calypso Business Analyst`, never leftover
  `Calypso Business Analysis MySQL`. Scoring chips stay as-is.
  People-first must emit this Apify step
  even when the LinkedIn boolean is empty. Official LinkedIn boolean
  stays repaired (`"Linux" OR "Python"`), never one quoted Skill (Must)
  blob, and is not sent to harvestapi.

  People-first Source next batch **executes harvestapi Full only**
  until official LinkedIn partner search is wired. Tavily
  `site:linkedin.com` is not the harvest and must not run, succeed
  with 0, or mint LinkedIn learning receipts. The autonomous loop
  worker (`claimed:0`) is not this path — grep the **web** process
  for `aria_harvest` / `[aria-harvest]` JSON on **stdout** (same
  channel as `sourcing_loop_tick`). Do not use `console.info`.
  First line is `request_received` (no empty `query: ""`). Then
  `request_entry` **before Tavily or any long wait**, with the
  harvest query from the brief (`Calypso Linux Python`), campaign
  title, and `apifyKeyPresent` (boolean, never the key). Then
  harvest lines with `actor`, `query`, `runId`, `status`, and
  `items`. If Fly has no line, the browser did not hit this process.

  A **Mock** Apify card is not a live key. Connected+Mock is not
  ready. `apifyKeyPresent` is **false** on Mock. Do not decrypt a
  Mock key. `started:false` on Mock must be visible in the UI
  (`PEOPLE_FIRST_HARVEST_MOCK` — toast that this is mock / connect
  a real Apify key and switch the card to Live). Never look
  Connected-and-ready then dead-button 0 people.

  Source next batch **always POSTs `/api/sourcing-agent`**. Do not
  infer a missing key from integrations 1/7 and silently run a
  fixture dry-run. A missing stored key fails loud **Connect Apify**.
  A real **Live** key starts harvestapi Full, people skill-match
  ≥60, cap ≤20.

  Same-site Origin is the **public product host** (`Host` /
  `X-Forwarded-Proto` + `X-Forwarded-Host`), not the Fly bind
  address (`http://[::]:3000`). A click from
  `https://aria-mantu-app.fly.dev` must reach `request_entry`. A
  false `CROSS_ORIGIN_REQUEST` on the product host is FAIL. A true
  cross-origin fails loud in the UI — never silent 0.

  handleSource / Source next batch must toast every people-first
  4xx/5xx, including `CROSS_ORIGIN_REQUEST` and
  `SOURCING_AGENT_UNAVAILABLE`. A rejected POST that becomes silent
  0 (no toast, no inline alert, Calypso still 0) is FAIL. Error
  toasts use `role="alert"` / `aria-live="assertive"` plus a durable
  `source-next-batch-error` banner. Do not map unknown HTTP errors
  to a swallowed generic unavailable string.

  `request_exit` must name the 503 gate
  (`prod_fail_closed`, `supabase_disabled`, `session_null`,
  `workspace_read_error`, `unhandled`). `campaign_invalid_state` is
  **not** a 503 and never Open Access & Keys. It is `CAMPAIGN_NOT_READY`
  (Complete and review the campaign brief) with zod issue codes on
  `request_exit` — no PII, no key. People-first must not die on a
  stale cloud-model settings blob, leftover GitHub / `@example.com`
  rows, or a reviewed brief missing optional shape fields
  (salary, githubQueries extras, VSS Consulting / Senior (7-10 years))
  before `request_entry`. A healthy product-host click with a valid
  stored Apify key prints `request_entry` with the brief query and
  `apifyKeyPresent` true.

  When the Apify card is Mock, `request_entry` has
  `apifyKeyPresent` false and `request_exit` is
  `PEOPLE_FIRST_HARVEST_MOCK` — not a generic
  `SOURCING_AGENT_UNAVAILABLE`. The toast must be that server
  code (Connect Apify / Mock mode), not a guessed 503. A generic
  `SOURCING_AGENT_UNAVAILABLE` toasts unavailable, not Mock.
  Campaign activity keeps an audit row for Mock / unavailable
  so the fail is not toast-only. Notes keep
  `PEOPLE_FIRST_HARVEST_MOCK` or `SOURCING_AGENT_UNAVAILABLE`
  plus the toast text (Connect Apify / Mock mode).

  The keyed path must **start** a harvestapi Full run. If start
  does not happen, fail loud (`PEOPLE_FIRST_HARVEST_NOT_STARTED`).
  Do not fall through to LinkedIn 0-rows. Do not depend on
  Playwright / browser-tools.

  Poll until the actor is terminal (`SUCCEEDED` / `FAILED` /
  `ABORTED` / `TIMED-OUT`). Do not stamp 0 people because a local
  wait elapsed while the run was still `RUNNING`
  (`PEOPLE_FIRST_HARVEST_STILL_RUNNING` + run-id). Client and
  server wait **90s**. A client abort is
  `PEOPLE_FIRST_HARVEST_ABORTED` — fail loud, never silent 0.

  ## Never 0 people (product law)

  Aria can **never find 0 people**. `items=0` is not a product result.
  0-and-stop is FAIL. A banner that stops at 0 is FAIL.

  Empty harvest MUST next-search until there is a real shortlist:

  - Keep the first query (`Calypso Business Analyst` / `Calypso Linux
    Python`). Ultron live proved that phrase can return `SUCCEEDED
    items=0`. That is a signal to continue, not a result.
  - Log the exact actor input (`actorInputField=searchQuery`,
    `actorSearchQuery` must equal the planned tokens). Field-name
    divergence is not the live bug.
  - Broaden to Calypso + BA skills that actually exist on LinkedIn
    (`Calypso Business Analysis`), then the platform alone (`Calypso`).
  - Next harvestapi input if the phrase AND returned 0: `searchQuery=
    Calypso` + `currentJobTitles=["Business Analyst"]`.
  - Next query if this phrase returned 0. Next actor-input if this
    actor input returned 0. Keep going.
  - Real shortlist only: email + phone + LinkedIn, skill-match ≥ 60,
    cap ≤ 20.

  FAIL: name-only, `@example.com`, leftover GitHub, fixture people,
  a banner that stops at 0. Do not invent people. Do not dress
  leftovers as the shortlist.

  Pipeline sourced for **this campaign** must match the visible
  shortlist, not a stale aggregate (the live "8 sourced" after a
  0-person run). After leftover strip, sourced is the visible
  people count.

  If a later query returns people without email + phone + LinkedIn,
  do not keep those rows and do not mint contacts — continue to the
  next planned search. `PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS`
  only after every planned search was tried. Never 15 identical `LinkedIn: 0 real candidates` rows.

  Short-mode discovery (no headline / about / skills) cannot prove
  a ≥60 skill-match. Mapping never stamps the JD title as
  `currentTitle` when the actor returned no headline. Positions
  are skill evidence. Name-only and empty rows stay FAIL. The
  finance gate still requires score ≥ 60, cap 20, and a CV citation.

  Fail loud when (a) the Apify key is missing, invalid, or the card
  is **Mock**, (b) the harvest never started, or (c) the run is still
  going. Do **not** fail-loud 0-and-stop because the first actor
  returned `items=0`. That is next-search. A valid **Live** key plus
  0-or-15-zero-rows is a harvest bug — fix the harvest (next query /
  next actor input), do not toast **Open Access & Keys**. Access & Keys
  stays the CTA when the key is missing, the card is Mock, or the
  harvest route did not complete.
- **Honor a valid stored harvest key.** Access & Keys is the source of truth
  for Apify. A key whose provider is Apify (including `Apify (sourcing)`)
  and `status === "valid"` **is** people-first harvest: `apifyKeyPresent`
  true, `apifyMock` false, harvestapi Full **starts** (`request_entry` +
  run-id). Do not require a Live toggle that the card never had. Do not
  decrypt a Mock key. Do not invent people.

  The operator **Mock** switch on a **real** card is still Mock —
  `PEOPLE_FIRST_HARVEST_MOCK`, `apifyKeyPresent` false. If the card is
  **Concept** or missing Live because merge demoted it, that is a product
  bug: treat a valid key as Live for harvest. Do not treat leftover
  GitHub / `@example.com` / `@fixture.example` rows as LinkedIn.

  On Live, do not throw `MISSING_PLUGIN` for a key that already tested
  valid. A Tavily key is **not** LinkedIn Sourcing. HeyReach API / MCP is
  a **LinkedIn send** account, not a people-search plugin.
- **Integrations must show the working surface.** Merge seed cards into
  stored workspace integrations so a live tenant cannot lose the Apify
  card or demote it to Concept. `isLinkedInSourcingCard` excludes Apify
  even though the name contains LinkedIn. The Apify (LinkedIn profile
  search) card is `real: true` with a Live mode switch, reflects a valid
  Access & Keys row (connected), and CTAs to `/settings` (Access & Keys)
  — never a Concept badge, never a missing Live toggle, never a toast
  with no button. Sidebar, Command Center strip, and Settings use the
  same connected count (`realIntegrationSummary`).
- **Unkeyed people-first is a connect flow, not a wall.** If there is no
  valid Apify key and no official LinkedIn RSC, the UI is in-product
  **Connect Apify / switch to Live** with copy that explains why — not a
  toast-only `MISSING_PLUGIN` dead end and not a silent fixture dry-run.
  Fly and other live workspaces **must not** hydrate
  `POST /api/source/need` `mode: "fixture"` JSON or
  `sourceEngineFixtureCandidates` onto a campaign. That route returns
  `FIXTURE_NOT_ON_LIVE` on Fly. Campaign activity keeps a durable audit
  row (Connect Apify), not a 5-second toast only. Never present leftover
  GitHub, `@fixture.example`, or `@example.com` as LinkedIn / live people.
  People-first Sourced is visible harvest people only. Mock / unkeyed empty
  campaigns fail loud Connect Apify without a second Source click.
- **LinkedIn Sourcing / RSC Configure is not an API-key paste.** Official
  LinkedIn partner search is **not wired**. Those cards must say that and
  send the operator to the harvest that is wired: a valid Apify key in
  Access & Keys / Source via Apify. Do not open a generic “Paste your API
  key” Configure. Fleet **Connect in Fleet** / Microsoft Graph OAuth is
  identity and messaging only — it is not partner search and must not be
  labeled as such. Concept-only is OK if labeled. It must not block Source
  when Apify is valid. Do not implement LinkedIn OAuth from a VM. Do not
  invent live people. Do not scrape. Outlook send is Fleet **Connect
  Microsoft account** (Graph OAuth, then Verify domain). Email Inbox SMTP
  is ingest, not the send path.
- **HeyReach is a LinkedIn send key, not a fake Live send account.** A
  valid HeyReach API / MCP row is the drafter’s LinkedIn send account.
  Integrations must not show HeyReach as Live/Connected with zero
  campaign or sender UI. Send stays dry-run until channel-connect **and**
  Tony approves that send. Never `example.com`.
- **Source via Apify** keeps focus in the search-query field so a full
  boolean can be typed. Start search returns a shortlist or a loud error
  in the modal. An empty harvest is a fail (no invented people, no
  spin-then-silent-idle, no “already matched” lie).
- After connect, Tony can contact people on **Outlook email and LinkedIn
  message**. Agents draft both channels into Needs Approval. When HeyReach
  API or MCP is connected, that is the LinkedIn send account the drafter
  uses. Send stays dry-run until **both** (a) the relevant channel is
  connected (Microsoft Graph / Gmail mailbox with a connected account +
  Verify domain for Email; LinkedIn seat / official RSC / valid HeyReach
  for LinkedIn) **and** (b) Tony explicitly approves that send. Never
  auto-send. Never send to `example.com` / `@fixture.example` (synthetic).
  Never send on his behalf without that gate. `gateOutbound` still blocks
  AI disclosure.
- If a required sensor is missing, the operator gets real paths — not a
  silent mock and not a toast-only wall:

  1. Source next batch / Run sourcing agent / Source via Apify using the
     valid **Live** Apify key when it exists.
  2. Otherwise fail loud **Connect Apify / switch to Live** — do not
     hydrate the fixture pool onto a Fly campaign.
  3. Connect LinkedIn (honest partner / Fleet OAuth) and Outlook (Fleet
     Graph + Verify domain) from the same flow.

Outreach send without channel-connect + explicit approve is a contract fail.
A valid Apify key that still throws `MISSING_PLUGIN` is a contract fail.
A non-JSON `/api/sourcing-agent` crash (Playwright / browser-tools loaded at
import) is a contract fail: people-first Source next batch must still run the
keyed Apify harvest. When the harvest does not complete (or the key is
missing), the operator gets a real next step — **Open Access & Keys** /
Source via Apify — never a Dismiss-only wall. When the key is already
valid and harvestapi returned 0, do not send the operator to reconnect.
Do not invent candidates. connect → source → outreach must not stop on
that toast. After a real shortlist, Outlook and LinkedIn contact stay
in-product; HeyReach drafts; send stays dry-run until channel-connect
**and** Tony approves that send. No OAuth from a VM. No send. No merge.

## OCR

- Text-layer PDFs: extract text and parse as a need or as CV evidence.
- Image-only / empty-text PDFs: require an OCR sensor. If none is configured,
  fail-closed with `OCR_REQUIRED` and the same three-path rule (re-export as
  text-layer PDF, paste the text, or configure OCR).
- Extracted text is evidence. Aria does not guess unread pages.

## Auth and Walteur fail-closed

Product APIs that run this engine:

- Call `prodFailClosed()` first (production without Supabase and without the
  sanctioned public-demo flag → 503).
- Require an authenticated principal with `source` (live) or a signed demo
  session (public demo). Anonymous callers get 401 and spend no provider quota.
- Live mode also rejects cross-origin browser mutations.

Outreach contact floor (`MIN_SCORE_FLOOR` 70) is a **separate** gate. This
contract does not lower it. This contract's 60% floor is shortlist inclusion.

## Acceptance needs (proof, not product names)

Calypso is a **client JD**, not a product and not a person. Do not rank
someone because the string "Calypso" is their name.

### Primary (E2E default)

**Calypso Application Support** — AMACAN / BNPP CIB - Canada / Montreal.

| Field | Value |
| --- | --- |
| Priority | Urgent but not Critical → `Urgent` (must not collapse to Critical) |
| Contract | CDI, start 05/10/2026, 1 head, 12 months |
| Remote | Possible partially remote → `Hybrid` |
| Profile | IS&D - Applicative Support |
| Seniority | Middle — From 4 to 6 years → `Mid`, min 4, max 6 |
| Language | English fluent |
| Skill (Must) | Linux, Python, Shell, Oracle, Grafana, Dynatrace, Linux Server |
| Function | Production support for the Calypso settlement system in Capital Markets (Trade Life Cycle, Settlements, Securities, Prime Brokerage). 24/7 global. |

Fixture: `tests/fixtures/tony-calypso-amacan-need.txt` (line-oriented VSS).

Intake must recover this brief from paste JD or a connected email. An empty
parsed brief (no title, no skills) is a FAIL. Manual field fill is not E2E.

### Second need (same VSS family — do not ignore)

**Senior Calypso Business Analyst** — same client / city family.

| Field | Value |
| --- | --- |
| Priority | Urgent and Critical → `Critical` |
| Seniority | Senior 7–10 years |
| Skill (Must) | Calypso, Business Analysis, MySQL |
| Domain | BA/MOA, T+1, Prime Brokerage/FI/Equities, SQL, Calypso back office |

Fixtures: `SAMPLE_VSS_CALYPSO_BA_MONTREAL`;
`tests/fixtures/ocr/calypso-ba-montreal-need.{pdf,png}`.

A combined VSS paste that contains both `Title` blocks must recover **both**
needs. The engine scores one need at a time; the primary E2E default is
Application Support.

### Recorded proof

Must prove, with a recorded command + `exit_code` + path (not a self-report):

1. Need in (paste JD or connected-email shape) → scored shortlist out.
2. Every shortlisted person scores ≥ 60, at most 20, ranked high → low.
3. At least one negative: a candidate whose only Calypso hit is their
   **name** scores under 60 and is not shortlisted.
4. Empty / name-only matches are FAIL.
5. Skills + CV/resume + LinkedIn (or other) experience are the only evidence
   channels. OCR recovers text-layer PDFs; image-only PDFs fail closed.

**Floor is 60.** The undeployed PR #53 80 floor is out of scope and must not
be adopted. Outreach contact floor (`MIN_SCORE_FLOOR` 70) stays separate.

**Production after land is Fly** (`https://aria-mantu-app.fly.dev/`). The
Vercel demo is not the bar. Empty cloud parse, clustered synthetic scores,
`language:Calypso`, unsplit Skill (Must), a quoted LinkedIn Skill (Must)
phrase, and empty LinkedIn `AND ()` are fails on Fly. The UI shows a baked
git SHA (`aria <sha>`) so Fly-show can prove which release is running.

## Out of scope

- Polo, WhatsApp as a required channel, billing, Vercel-only work.
- Weakening the floor for a "quick" path.
- Invented live candidates. Automated LinkedIn login, scrape, or rate-limit
  bypass. Completing OAuth from a VM.
- A second coding PR. Leftover PR #53 stays open and unmerged.

This contract's one logical product path is **connect → source → outreach**.
Command Center, Source next batch, and the send gate are in scope for that
path. The app name stays Aria.

## Command Center home chrome

Product is Aria, an agentic sourcing assistant. Calypso is a NEED, never the
product name. Login/home chrome reads as Aria, then the active need.

- Sidebar brand stays ARIA.
- Returning Command Center H1 is Aria-shaped: "Aria" or "Your next move is
  ready." NEVER the campaign title (the live bug: H1 is `nextStep.reason`
  with "Acting on " stripped, so Senior Calypso Business Analyst is the
  product title).
- Active need is a campaign chip (header selector already) plus an optional
  chip/subtitle "Acting on {title}". Not the H1. First-run H1 stays
  "Paste a job. Aria finds people."
- Decorative orbital/blobs live in a clipped layer
  (`absolute inset-0 overflow-hidden pointer-events-none`) that MUST NOT
  expand any scroll container. Prove at 1280 and 1440 that the Command
  Center root `scrollWidth <= clientWidth`. Do NOT ship `overflow-x: hidden`
  on html/body as the fix (Tony: no first-pass hide).
- Integration pills (`cc-integration-pills`) wrap (`flex-wrap` +
  `min-w-0` + `max-w-full`). Do not leave `whitespace-nowrap` chips in a
  non-wrapping flex row — that is the live 1270 overflow (pills right
  edge ~1690, page `scrollWidth` 4311). A 1270-wide viewport must not
  get a horizontal scroller from the topbar strip. Contain the pills;
  do not hide the page.

