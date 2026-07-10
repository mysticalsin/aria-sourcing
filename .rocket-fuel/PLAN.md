# PLAN v4 — MSourcing: real paste→candidates + safe Tavily surface + LinkedIn dual-track + mailbox OAuth
Visionary: Claude · Mode: audit · Revised through Round 3 (findings IDS'd in meetings/001,002,003-same-page.md).
Live smoke already run (scripts/smoke-source-live.mts): the loop is REAL (parser→role→live GitHub→5 real profiles) but returned ORGS (openai/google) not people — so Rock 1 adds a quality bar: `type:user` + location + title in the query, assert results are users.

## Goal (one sentence)
Tony pastes a real hiring need (email text) into the live app and gets back real, fitting candidates from ≥2 platforms (GitHub live + web/LinkedIn via a Tavily key added through a safe in-app surface), with every provider key persisted encrypted server-side — no mock data in the core sourcing path.

## Non-goals (this wave)
- Billing, native mobile (Owner).
- store.ts monolith refactor + GDPR erasure spine (separate engagement).
- Deploy to prod Supabase/Vercel (deploy engagement; here we prove on the live LOCAL stack :3003 + tests + a live smoke).
- Automated LinkedIn candidate API (does not exist; RSC is ATS↔Recruiter sync, not sourcing — see research-linkedin-rsc.md). Rock 5 drafts the partnership honestly; builds no fake.
- Wave-2 items (winlog, exec dashboard, Databricks) — tracked in goal m13-m15, their own later meeting.

## Verified baseline (corrected after Rounds 1+2)
- Fresh gate THIS session (in-repo proof, untracked until the Owner's G6 commit: .rocket-fuel/gate-proof.txt): `npx tsc --noEmit`=0; `npm test`=0, **82 unique test files "passed, 0 failed"** (package.json: 79 test refs + 3 pretest refs). Worktree dirty: 3 modified (package.json/-lock from an `undici` add + .claude lock) + untracked (.rocket-fuel/ + pre-existing floor3d). Rock 7 reconciles dirty state.
- ENCRYPTION IS CONDITIONAL: crypto-secrets.ts:51 encryptSecret returns PLAINTEXT when DATA_ENCRYPTION_KEY is unset; encryptionRequiredButMissing() (crypto-secrets.ts:47) only fails closed in prod/non-demo. DATA_ENCRYPTION_KEY is currently UNSET locally + in the container → a key saved via the surface today is stored plaintext. Making the surface "safe" (Owner's word) REQUIRES setting DATA_ENCRYPTION_KEY.
- Paste→candidates chain REAL: POST /api/intake → parseEmailAndJD (genuine regex parser, mock-ai.ts:351) → createCampaignFromAnalysis → sourceNextBatch → roleProfile(jobAnalysis).platforms[0] → /api/source. GitHub branch src/app/api/source/route.ts:106-115; web branch :118-129.
- GitHub sourcing real: github.ts:14-121 (search + profile). Live-verified once by curl (90 Paris React devs) — but NOT a committed artifact; Rock 1 fixes that.
- Encrypted key store EXISTS: /api/keys POST → api_keys table, AES-256-GCM (crypto-secrets), admin-RLS, last4-only to browser. UI: api-keys-panel.tsx. Enum: types.ts:1017 API_KEY_PROVIDERS ALREADY includes Apollo, Seamless, Sillage (+ LLM providers). **Only "Tavily" is missing.**
- Stored-key resolver pattern EXISTS: resolveStoredApolloKey(session) apollo.ts:197-214 (workspace-scoped, service-role decrypt). Sillage + hermes-proxy identical shape.
- web_search key: webSearch reads ONLY process.env.TAVILY_API_KEY (web-tools.ts:193-201). Single dispatch point runWebTool(name,args) (web-tools.ts:284) has NO key param. Six call sites: source route:119, sourcing-tools.ts:110, tool-loop.ts:51, /api/sourcing-agent:142, /api/agents/run:87, hermes/chat:255.
- Mailbox OAuth code complete (auth/google/route.ts): requireAdmin FIRST (:21-29), THEN checks GOOGLE_CLIENT_ID (:26). Google/MS creds are placeholder-only in .env.local.example:67-72 / .env.production.example:48-57 — not configured.
- LinkedIn: web-leads.ts site:linkedin.com/in search → sparse leads; wire-enforcement manual-only (linkedin-policy.ts:72-80, 18 tests). No API.

## Architecture (grounded on the code above)
- **Tavily key — FULL chokepoint (ALL paths, per Rounds 2+3)**: add optional `runWebTool(name, args, opts?: {tavilyKey?: string})` → `webSearch(query, tavilyKey?)` → `tavilyKey ?? process.env.TAVILY_API_KEY`. web-tools.ts stays Supabase-free (R2). Thread the key through every path that reaches runWebTool:
  (i) `tool-loop.ts execTool` BUILTIN_WEB_URL branch (generic MCP-style tools) — via a tavilyKey field on the loop context passed to runAnthropicWithTools/runOpenAiWithTools;
  (ii) `sourcing-tools.ts makeSourcingToolRunner` — add a `tavilyKey` param mirroring the existing `githubToken` param (Round 3 catch: this runner is `server.run`, dispatched at tool-loop.ts:50 BEFORE the BUILTIN_WEB_URL branch, and calls runWebTool directly at :110);
  (iii) `source route` direct runWebTool call.
  Each request entry resolves resolveStoredTavilyKey(session) ONCE and passes it into whichever runner/loop it builds: source route, sourcing-agent (builds makeSourcingToolRunner), agents/run, hermes/chat. Covers all 7 reach-points. Default (no key) = env→DDG, backward-compatible.
- **Safe storage (Round 3)**: the plaintext risk is NOT just provider keys — every encryptSecret caller (provider keys AND OAuth mailbox tokens in google/microsoft/email-sync/outreach/calendar) stores plaintext when DATA_ENCRYPTION_KEY is unset. Setting DATA_ENCRYPTION_KEY in the local stack (.env.local + container) fixes ALL paths at once. Additionally harden encryptionRequiredButMissing so ANY real-data workspace (not just prod) refuses a plaintext secret write. Owner's "safe" = encrypted at rest, always, for every secret.
- **Honesty**: integrations.ts real:false cards → status:'not_configured' + lastSync:null (kill fabricated 'connected'); dispatch-outbound unconfigured!=failed.
- **Mailbox**: no code change — GOOGLE_OAUTH_SETUP.md + confirmed env plumbing + a route test mocking admin+non-demo.
- **RSC**: docs/partnerships/linkedin-rsc-application.md from research-linkedin-rsc.md (honest: RSC ≠ sourcing API).

## Standards (Owner-locked)
Reuse patterns; no new fake paths; secrets encrypted+admin-RLS+never-to-browser; gate green (tsc+test 0; lint 0 ERRORS — the 1 exhaustive-deps warning acceptable, fixed opportunistically); LinkedIn wire-enforcement + guardrail suites stay green (never weakened); Owner approves commits.

## Risks (unchanged + R1 concurrent-writer live)
R1 concurrent writer (fresh git status per rock, atomic commits, worktrees). R2 layering (resolve key in route, pass string only — DESIGNED IN above). R3 codex quota (waves, degrade loud). R4 Tavily/LinkedIn ToS (keep SSRF+robots; discovery only; outreach manual). R5 OneDrive eviction (build proof from non-OneDrive clone if it recurs).

## Rocks v4 (proof responsibility split per Round 2: Rock 2 proves the SURFACE wiring offline; Rock 1 proves REAL candidates live)
Every rock CREATES its own proof file as a deliverable (they don't exist yet — that's expected, not a gap).
- **Rock 2 (build first — everything depends on it)**: Safe Tavily key surface + FULL chokepoint (all 7 reach-points).
  (a) set DATA_ENCRYPTION_KEY in the local stack (fixes plaintext for ALL encryptSecret callers — provider keys AND OAuth tokens); harden encryptionRequiredButMissing so any real-data workspace (not just prod) refuses plaintext secret storage.
  (b) add "Tavily" to API_KEY_PROVIDERS (types.ts) + Tavily format validator (providers.ts).
  (c) resolveStoredTavilyKey(session) mirroring apollo.ts:197.
  (d) thread optional tavilyKey through EVERY path to runWebTool: runWebTool→webSearch; tool-loop execTool BUILTIN_WEB branch (via loop context); makeSourcingToolRunner (new tavilyKey param beside githubToken); direct source-route call. Resolve+pass in source route, sourcing-agent, agents/run, hermes/chat.
  Proof: `npx tsx tests/web-tavily-key.mts` (rock creates it) using the fake-Supabase harness (pattern from commit a87fed7) — asserts: encryptSecret round-trips under a set key; resolveStoredTavilyKey returns the decrypted workspace key; a stubbed webSearch RECEIVES the stored key through BOTH the source-route path AND the makeSourcingToolRunner path when env is unset; env fallback still works; validator rejects junk; encryptionRequiredButMissing blocks a plaintext write for a real-data workspace. Exit 0.
- **Rock 1 (COMPANY, build second)**: Prove paste→REAL, FITTING candidates from ≥2 platforms live. `scripts/smoke-source-live.mts` exists (already run: loop is real). Rock 1 UPGRADES it to a quality bar: (a) parser must extract location from "in London"/"team in London" into jd.location (parseEmailAndJD gap — the smoke returned location=""); (b) GitHub query must add `type:user` + location + a title/skill term so results are PEOPLE not orgs (the smoke returned openai/google/huggingface — orgs); (c) assert every returned candidate is a user account (not org) with a real github.com/<login> URL; (d) also assert ≥1 real Tavily web/LinkedIn lead. Proof: `npx tsx scripts/smoke-source-live.mts` exit 0, prints real fitting candidates. LIVE (network+GITHUB_TOKEN+TAVILY) — NOT the offline gate. The stored-surface wiring is proven offline by Rock 2 (division explicit).
- **Rock 3**: Honesty. integrations.ts real:false cards → status:'not_configured'+lastSync:null; dispatch-outbound 'unconfigured'!='failed'. Proof: `npx tsx tests/integrations-honesty.mts` (rock creates it) — asserts NO card has (real:false AND status:'connected').
- **Rock 4**: LinkedIn compliant discovery real. With a Tavily key, web-leads yields real public LinkedIn leads; site-scoped search + sparse extraction ONLY, no scraping/automation; wire-enforcement untouched. Proof: `npx tsx tests/linkedin-policy.mts && npx tsx tests/web-leads.mts && npx tsx tests/outreach-guardrails.mts` all green + a discovery-shape assertion.
- **Rock 5**: Mailbox OAuth setup. production-readiness/GOOGLE_OAUTH_SETUP.md (OAuth app, gmail.send+calendar scopes, redirect URIs local:3003+prod); confirm env plumbing. Proof: `npx tsx tests/auth-google-redirect.mts` (rock creates it) — mocks authed admin + non-demo, dummy GOOGLE_CLIENT_ID, asserts /auth/google redirect Location host == accounts.google.com.
- **Rock 6 (Visionary-owned, rule 4)**: LinkedIn RSC partnership draft. docs/partnerships/linkedin-rsc-application.md from research-linkedin-rsc.md, sections {what RSC is/is-not · eligibility · Job-Posting prerequisite · 5 dev + 6 cert modules · OAuth 2-legged · interim compliant posture · honest recommendation}. Proof: `grep -c` all 7 section headers present.
- **Rock 7**: Green gate + reconcile. Full offline gate; commit gate-proof; resolve dirty worktree. Proof: `npx tsc --noEmit && npm test` exit 0 (82 files, 0 failed); `npm run lint` 0 errors. No-spaghetti = Visionary Level 10 judgment, not a rock proof.

Order: Rock 2 → Rock 1 → 3,4,5,6 (distinct files, worktree-parallel-safe) → 7. Under tight quota build 2→1→3 first (Tony's core acceptance + safety + honesty), carry 4-6.
