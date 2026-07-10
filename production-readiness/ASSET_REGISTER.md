# ASSET REGISTER — MSourcing (Hermes Sourcing by Mantu)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Phase 1 deliverable.** Audit date: 2026-06-27. New document.
Inventory of assets, their classification, owner (UNKNOWN — see UNKNOWN_ITEMS), and
where they live. Used by the threat model and risk register. Every "where" is repo-verified;
production hosting/ownership is UNKNOWN-blocked-on-access.

Classification key: **C** = Confidential/secret, **PII** = personal data, **R** = restricted/internal,
**P** = public/low.

---

## 1. Data assets

| Asset | Class | Store (live) | Store (demo) | Notes / evidence |
|---|---|---|---|---|
| Candidate PII (name, email, LinkedIn/GitHub, employer, title, tech, activity) | PII | `workspace_state.state` JSONB | `localStorage` | DATA_FLOW.md; `types.ts` Candidate |
| Candidate email (de-dupe key) | PII | `outreach_ledger.candidate_email` | n/a | immutable, no client DELETE (0005) |
| Outreach messages (subject/body, personalization) | PII/R | `workspace_state` | `localStorage` | generated + sent content |
| Classified replies (verbatim excerpts, intent) | PII | `workspace_state` | `localStorage` | candidate-authored text |
| Operator chats with Aria | R/PII | `workspace_state` | `localStorage` | full thread history |
| Agent memory entries | R/PII | `workspace_state` | `localStorage` | may reference candidate names |
| Operator identity (email, name, role) | PII | `profiles`, `agent_seats.operator_email`, `api_keys.created_by` | session | |
| Suppression list (opt-outs, blocks) | PII | `suppression_list` | `localStorage` | consent/DNC data |
| Provider API keys | **C** | `api_keys.secret` | not persisted | col-grant hides `secret`; service-role only |
| OAuth mailbox tokens | **C** | `email_connections.access_token/refresh_token` | n/a | col-grant hides tokens; service-role only |
| Synthetic seed data | P | code | code | `seed.ts`, `mock-ai.ts` (current data is synthetic) |

**Encryption at rest:** Supabase-managed (prod, UNKNOWN/unverified). `localStorage` and local
backup `*.sql.gz` are **plaintext** (`scripts/backup.sh:5`). **In transit:** HTTPS to all external
APIs; HSTS declared in `vercel.json` only.

---

## 2. Credential / secret assets (env)

| Secret | Sensitivity | Location | Rotation |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | CRITICAL (RLS bypass, all data) | env (server) | UNKNOWN |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | low (RLS-protected, public) | env (browser) | UNKNOWN |
| `GOOGLE_/MICROSOFT_CLIENT_SECRET` | high (OAuth app) | env (server) | UNKNOWN |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` | high (send-as) | env (server) | UNKNOWN |
| `HERMES_API_KEY` / `HERMES_PROXY_SECRET` | high (Aria access) | env (server) | UNKNOWN |
| `ANTHROPIC/OPENAI/GROQ/XAI/MISTRAL_API_KEY` | high (billable) | env (server) | UNKNOWN |
| `DEMO_ADMIN_PASSWORD` | medium (dev-only, route 404 in prod) | env (server) | fallback default `admindemo123` |
| Per-workspace vault keys | high | `api_keys.secret` | manual via UI/API |

No secrets committed to git (`.env*.local` gitignored; `.env.local` untracked, empty values).
Secret manager / KMS in prod: UNKNOWN. CI secret scan: gitleaks (`ci.yml`) — needs a remote to run.

---

## 3. Code / repo assets

| Asset | Value | Risk |
|---|---|---|
| Source repo (local git, branch `main`) | the product | **HIGH — no git remote; no off-machine backup; CI cannot run; working tree dirty (73 M / 86 ??)** |
| `package-lock.json` | reproducible build | pinned; audit findings below |
| Supabase migrations (5) | schema-as-code | not verified applied to a live DB |
| Tests (22 `.mts` suites) | regression safety | run via `tsx`; not executed in this phase |
| Ops scripts (3) | backup/restore/local-up | target LOCAL Docker Supabase only |

---

## 4. Dependency-risk snapshot (`npm audit`, 2026-06-27)

**5 vulnerabilities: 4 HIGH + 1 MODERATE — all in the Next.js dependency tree.**

- Next.js advisories: DoS (Server Components), middleware/proxy cache-poisoning, XSS (CSP
  nonces; beforeInteractive scripts), Image-Optimization DoS, **SSRF via WebSocket upgrades**,
  RSC cache poisoning, middleware/proxy bypass (Pages Router i18n).
- `postcss <8.5.10` (moderate) — XSS via unescaped `</style>`.
- Advertised fix is `next@16.2.9` (**major / breaking** from ^14.2.35). `npm audit` is
  **non-blocking** in CI (`ci.yml:39` `|| true`).

Owner action: cross-ref SECURITY_REVIEW / RISK_REGISTER. Inventory note: the app is on the
Next 14.2 line which carries multiple HIGH advisories; upgrade path is a major version.

---

## 5. External service / processor assets (data leaves to)

| Processor | Data sent | Classification |
|---|---|---|
| Supabase (DB/auth) | all app data + auth | PII/C |
| Anthropic/OpenAI/Groq/xAI/Mistral | candidate PII in prompts (live) | PII |
| Resend / SendGrid | candidate email + message | PII |
| Google (Gmail/OAuth) | candidate email + message + token exchange | PII/C |
| Microsoft (Graph/OAuth) | candidate email + message + token exchange | PII/C |
| Public DNS | sender domain queries | P |
| Aria/Hermes runtime | candidate fields in prompt (private host) | PII |
| fonts.googleapis / db.onlinewebfonts / CloudFront | none (static assets) | P |

No signed Data Processing Agreements verifiable from repo (UNKNOWN_ITEMS / compliance).

---

## 6. Infrastructure assets

| Asset | State |
|---|---|
| Hosting (Vercel cdg1 declared) | UNKNOWN — not accessed/verified; no project linkage in repo |
| Supabase project (prod) | UNKNOWN — only local `config.toml` + migrations present |
| DNS / domain / TLS cert / WAF / CDN | UNKNOWN — none in repo |
| Monitoring / logging / alerting | NONE in repo (structured `console` logs only) |
| Backups (prod) | NONE verified; only local gzipped dumps under `backups/` |
| CI/CD runner | UNKNOWN — workflows defined, no remote to execute them |

---

## Summary

Highest-value assets are the **per-workspace candidate PII + recruiter content** (in one JSONB
blob / localStorage) and the **service-role key + OAuth mailbox tokens + provider keys**. The
most urgent asset-management gap is the **absence of a git remote** (single point of source loss,
CI inert) and the unverifiable production hosting/backup/monitoring posture. Ownership, rotation
policy, retention, and DPAs are all UNKNOWN and require business decisions/access.
