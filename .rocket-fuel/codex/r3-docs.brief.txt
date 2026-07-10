You are the Integrator building release Rock R3 in the MSourcing repo. workspace-write. Owner standard: enterprise-ready, senior-dev-clear, no slop, docs a senior full-stack dev + an enterprise buyer trust in 5 minutes. Fix stale/contradictory docs; do NOT add doc sprawl — consolidate.

Objective: one truthful front door + one canonical deploy story + accurate env examples + a dated status page, all matching the code as it actually is TODAY.

Read first: (understand before editing — verify every claim against code, do not copy old numbers)
- package.json (real Next/React versions — the app runs Next 16 / React 19, NOT 14/18); the real test count; the lint/node lines.
- README.md — stale: claims Next 14/React 18; §7 architecture tree wrongly places supabase/migrations/ and tests/ under src/ (both are repo ROOT); omits shipped surfaces (/careers, /exec, /winlog, Databricks intake, MCP query-auth); has a "plug in real APIs later" table with rows that are now BUILT.
- Root DEPLOYMENT.md — stale (Next 14, Hermes-runtime-centric; env section omits CRON_SECRET / OUTREACH_UNSUBSCRIBE_BASE_URL / DATA_ENCRYPTION_KEY). production-readiness/DEPLOYMENT_RUNBOOK.md + DEPLOY_CHECKLIST.md are the real ones.
- SUPABASE_SETUP.md (stops at migration 0005), other docs stop at 0012/0015 — migrations now run 0001–0018 (0016 intentionally absent). Stop enumerating migrations anywhere except ONE annotated list.
- .env.local.example + .env.production.example — missing vars the code reads: TAVILY_API_KEY (grep process.env.TAVILY), KIMI_API_KEY/KIMI_BASE_URL, DEMO_SESSION_SECRET, DATA_ENCRYPTION_KEY note, GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI. Regenerate from an actual `grep -rho "process.env.[A-Z_]*" src | sort -u`.
- production-readiness/*.md due-diligence pack — a 2026-06-27 snapshot whose headline ("0 of 14 gates PASS — NOT READY", 22 suites) contradicts current state (97 suites, sourcing/security/dashboard/Databricks/MCP shipped).

Build:
1. README.md — make it the accurate front door: what the product IS (one paragraph), correct stack (Next 16/React 19/TS, Supabase, the real test count), a correct architecture map (src/app, src/lib, src/components, supabase/migrations at ROOT, tests/ at ROOT), how to run local (scripts/local-supabase-up.sh + npm run dev), how to deploy (pointer to the canonical runbook), where major surfaces live (sourcing, outreach+guardrails, security disclosure layer, exec dashboard, winlog, Databricks intake, MCP). Move BUILT rows out of any "later" table. No marketing fluff.
2. Migrations: every doc that enumerated migrations now says "apply everything in supabase/migrations/ in order (`supabase db push`)". Keep ONE annotated per-migration list, in DEPLOYMENT_RUNBOOK.md, current through 0018 with a one-line "0016 intentionally unreleased — gap is deliberate" note.
3. .env examples: regenerate both from the real process.env grep; add the missing vars with a one-line purpose each; mark which are REQUIRED for LIVE prod vs optional. Never include real secret values.
4. Canonical deploy: reduce root DEPLOYMENT.md to a 5-line pointer at production-readiness/DEPLOYMENT_RUNBOOK.md (canonical) + the vercel-demo variant; or delete it. Ensure the runbook's required-env list is complete (CRON_SECRET, OUTREACH_UNSUBSCRIBE_BASE_URL, DATA_ENCRYPTION_KEY, Supabase trio, a delivery key, Google OAuth).
5. Add production-readiness/STATUS.md (dated today): one page — current posture (what passed/changed since the old snapshot: 97 test suites, tsc/lint green, sourcing real, encryption-at-rest via DATA_ENCRYPTION_KEY, RLS tenancy, candidate-disclosure security layer, honest metric definitions), a short data-handling summary, and the remaining go-live steps (cloud Supabase + env + domain). Supersede — do not delete — the old snapshot; add a top-line "SUPERSEDED by STATUS.md 2026-07-10" banner to it.
6. Product name: add ONE sentence to README reconciling the MSourcing / ARIA / Hermes naming so a reader isn't confused.

Constraints: (what must NOT change) no code changes; do not invent metrics — every number must be verifiable (test count from `npm test`, versions from package.json); no new doc files beyond STATUS.md; keep it tight.

Proof: a grep-based check script tests/docs-truth.mts (repo test style) asserting: README does NOT contain "Next.js 14" or "React 18"; .env.local.example CONTAINS TAVILY_API_KEY and DATA_ENCRYPTION_KEY; no doc says "apply migrations 0001-0005" or "-0012" as the full set; STATUS.md exists and contains today's date and "97". The Visionary also reads the README top-to-bottom for truth. tsc unaffected (docs only) but run it.

Stop when: README/env/deploy docs are truthful and consolidated, STATUS.md exists, tests/docs-truth.mts encodes the assertions, tsc clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = docs truthful + consolidated + STATUS.md + test; REVISE = blocked/incomplete (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
