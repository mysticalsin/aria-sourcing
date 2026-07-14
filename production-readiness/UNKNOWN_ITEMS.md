# UNKNOWN / UNVERIFIABLE ITEMS — MSourcing

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Audit date:** 2026-06-27. Supersedes prior version (which incorrectly listed "no CI
pipeline / no IaC" — CI + CodeQL workflows and 5 Supabase migrations now exist).

Each item could not be verified because the system/account/decision does not exist or was
not provided. Per operating rules these are **never PASS** — they are FAIL or UNKNOWN until
the access/decision is supplied. Each lists exactly **what is needed to resolve it**.

---

## A. Blocked on missing ACCESS / accounts (UNKNOWN)

| # | Item | What's needed to resolve |
|---|---|---|
| A1 | **Git remote / source backup** — repo is local-only, no remote | Create remote (GitHub/GitLab), push `main`, confirm protected-branch + off-machine backup |
| A2 | CI/CD execution — workflows exist (`ci.yml`, `codeql.yml`) but no host | A1 + a CI runner; then attach a green run as evidence |
| A3 | Cloud/hosting account (Vercel project) — IAM, env vars, regions, logs | Vercel project access (or chosen host) to verify env, build, runtime, function logs |
| A4 | Supabase production project — RLS live behaviour, encryption, network rules, backups | Prod Supabase project access (or staging) to run RLS/tenant-isolation tests against real data |
| A5 | DNS / domain / TLS cert / WAF / CDN / rate-limiting at edge | DNS + hosting access; confirm cert, HSTS preload, WAF/rate-limit posture |
| A6 | Monitoring / APM / log aggregation / alerting | Decision on stack (e.g. Vercel Analytics + Logflare/Datadog) + access to verify dashboards/alerts |
| A7 | Backup system + restore drill for PROD data | Prod DB access; run an actual restore drill (local `restore-drill.sh` only proves local) |
| A8 | Authorized pen-test / external-scan scope (domains/IPs) | Written scope; none provided ⇒ no active/external testing performed |
| A9 | OAuth app registrations (Google/Microsoft/Supabase Entra) — scopes, redirect URIs, consent | Console access to verify least-privilege scopes + verified redirect URIs |
| A10 | Aria/Hermes runtime host + network path from app | Confirm where Aria runs and whether the app's private-host SSRF allow-list can reach it (see ARCHITECTURE §6) |

---

## B. Blocked on BUSINESS DECISION (UNKNOWN until decided)

| # | Decision needed |
|---|---|
| B1 | Deployment target, region(s), hosting model (Vercel vs self-host — affects Aria reachability) |
| B2 | Database of record + commitment to Supabase; confirm shared-org (per-email-domain) tenancy is acceptable for PII isolation |
| B3 | SLO targets (uptime, latency, error rate), expected load/RPS, data volume/growth |
| B4 | RTO / RPO for backups (drives backup frequency, retention, replication) |
| B5 | Compliance scope — GDPR is near-certain for EU candidate PII; SOC 2 / ISO 27001 / others? |
| B6 | Data retention + deletion/export policy for candidate PII (Art. 17 erasure across `outreach_ledger` is not implemented — see DATA_FLOW gap) |
| B7 | Production auth model — disable demo "Continue without account"; confirm SSO IdP + MFA requirement (local config has MFA off, min password length 1) |
| B8 | Asset ownership / on-call / accountable owner for each asset in ASSET_REGISTER |
| B9 | DPAs with sub-processors (Supabase, LLM providers, Resend/SendGrid, Google, Microsoft) |
| B10 | Whether the self-hosted Aria path is in production scope, or cloud-LLM-only |

---

## C. Verifiable in CODE but NOT proven for PRODUCTION (UNKNOWN)

| # | Item | Evidence in code | Why still UNKNOWN |
|---|---|---|---|
| C1 | RLS / tenant isolation | `supabase/migrations/0005_rls_tenant_isolation.sql` (thorough) | not executed/tested against a live DB |
| C2 | Encryption at rest / in transit for deployed DB | Supabase default | no prod project to confirm |
| C3 | Secret manager / KMS in deployment | server-side vault + env | deploy-time secret storage unverified |
| C4 | Real send/sourcing adapters end-to-end | Resend/SendGrid/Gmail/Graph code present | never sent live; depends on verified domain + live seat + keys |
| C5 | OAuth CSRF protection on mailbox connect | `state` = base64 JSON, no session-bound nonce | needs live test / decision (cross-ref SECURITY) |
| C6 | Security headers as served | `next.config.mjs` + `vercel.json` (two definitions, may drift) | not verified on a deployed response |
| C7 | Dependency vulns remediated | `npm audit` = 4 HIGH + 1 MOD (Next.js tree), non-blocking in CI | fix is a major Next.js upgrade; not done |
| C8 | Health probe wired to a monitor | `/api/health` exists | no monitor configured to poll it |

---

## How to convert any item to PASS

Provide the access/account/decision, then re-run the relevant phase and attach concrete
evidence (live test output, dashboard screenshot, applied-migration confirmation, green CI
run, restore-drill log). Until then, each item remains UNKNOWN/FAIL by the conservative rule.
