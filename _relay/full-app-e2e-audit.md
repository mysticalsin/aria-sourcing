# Full-app E2E tangibility & UX audit

**Date:** 2026-09-11  
**Environment audited:** Fly production only  
- App: https://aria-mantu-app.fly.dev (`/api/health` healthy; `/api/ready` → `agentFrameworks: false`)  
- Computers: https://aria-mantu-computers.fly.dev/health → `max: 5`, `desktop: true`, `stream: x11vnc+novnc`  
**Policy:** All runtime / deploy changes stay on **Fly**. Vercel is not production for LinkedIn / AriaBot / OpenBot.

---

## Executive verdict

The product has a **real Fly spine** (app + Kong/Supabase + Chromium computers). Many surfaces are wired. It is **not yet Apple-level seamless** end-to-end: several Settings controls are preference theatre, Deploy historically created seats without booting VMs, host VM cap (5) is far below fleet UI max (300), and Automatic LinkedIn “Ready” could be claimed without a live Browser Computer path.

**Tangibility score (honest):** ~6.5 / 10 for core hiring loop on Fly; ~4 / 10 for “N agents on the 3D floor each with own logged-in VM” until host capacity + login are finished.

---

## Deploy surface (Fly-only)

| Surface | Role | Status |
|---|---|---|
| `aria-mantu-app` | Next.js product | Live; login-gated (307 → `/login`) |
| `aria-mantu-computers` | Headed Chromium / desktop VMs | Live; **MAX=5** |
| `aria-mantu-kong` | Supabase API gateway | Referenced by app env |
| Vercel demo | Must not run LinkedIn/OpenBot | **Out of scope** — do not point `COMPUTER_SUPERVISOR_*` at Vercel |

---

## Navigation map (27 primary routes)

| Section | Route | Tangible? | Notes |
|---|---|---|---|
| Command Center | `/` | Partial | CTAs for source / review / report; dry-run defaults soften “real send” |
| Funnel | `/funnel` | Partial | Stage moves are store-real; little execution CTAs |
| Intake | `/intake` | Live/Demo | Parse + create campaign; demo substitutes Talent Pool without Supabase |
| Launch | `/launch` | Live/Demo | Multi-wave source; honest “nothing sent” badge |
| Campaigns | `/campaigns`, `/campaigns/[id]` | Live | Source / pause / outreach cards; send needs live seat |
| Applicants | `/applicants` | Partial | Status mutations; reject copy can overclaim email send |
| Candidates | `/candidates` | Live/Demo | Source + draft; send lives on Outreach |
| #Vivier | `/vivier` | Partial | Re-contact drafts → still need Outreach approve/send |
| Outreach | `/outreach` | Live | Approve + Send; **Allocate on Fleet** CTA |
| Replies | `/replies` | Partial | Labelled **Queue draft reply**; sync may dry-run in public demo |
| Calendar | `/calendar` | Partial | Bookings store-real; calendar provider event needs live mailbox |
| Agent Fleet | `/fleet` | Live | Deploy / Computers / Take control — **core tangibility surface** |
| Ops Floor | `/floor` | Live+overlay | Seats + computer status overlay; 3D render-capped |
| Chat | `/chat` | Conditional | Hermes when configured |
| Replay | `/replay` | Read-only | Event DVR, not live VMs |
| Exec | `/exec` | Derived | KPI dashboard from store |
| Winlog | `/winlog` | Derived | Wins table |
| Reports | `/reports` | Live | Generated from campaign |
| Sessions | `/sessions` | Read | Activity / decision history |
| Trust & ROI | `/trust` | Illustrative | Often synthetic demo framing |
| Agent Studio | `/studio` | Conditional | Specs / runs when agent APIs up |
| Architecture | `/architecture` | Docs | Org viz / future flags |
| Skills | `/skills` | Live | Learning proposals |
| Memory | `/memory` | Conditional | Needs agent memory APIs |
| Files / Curator | `/curator` | Conditional | Hermes proxy |
| Soul | `/soul` | Live settings | Persona / brain config |
| Settings | `/settings` | Mixed | See deep dive below |
| Login | `/login` | Live | Azure / password / demo paths |

---

## Settings deep dive (9 tabs)

| Tab | Subsections | Wired? | Apple-bar gaps | Sev |
|---|---|---|---|---|
| Get started | Setup guide | Heuristic checklist | Login/send steps often never flip complete | P1 |
| Integrations | Email OAuth, LinkedIn stack, Databricks, roadmap cards | Email/LinkedIn/Databricks real; many cards `real: false` | Roadmap Configure → **Coming soon** (disabled); Notifications banner: preference-only | fixed |
| AI & Models | Providers, recruitment LLM, models, tools, MCP, Hermes, Dust | Keys + chat paths real when configured | Split across too many panels | P2 |
| Fleet & Automation | Rate limits, notifications, guardrails, schedules | Prefs persist; schedules may lack runner | Schedules UI without fire feels broken | P1 |
| Observability | Pulse + reply autopilot docs | In-memory / docs | Not durable ops telemetry | P2 |
| Approval & Compliance | Dry-run, approval, GDPR toggles | Store prefs | Claim > enforcement proof | P1 |
| Brand Voice | Humanizer, guardrails Ask Aria | Humanizer toggle may be no-op; Ask Aria heuristic | Looks like LLM chat | P1 |
| Access & Keys | API keys, roles | `/api/keys` live | Dense | P2 |
| Workspace | Identity, language, maxAgents | Persist | **maxAgents can exceed Fly VM cap** | P0 |

### LinkedIn connection UX (critical)

1. **Automatic delivery** must mean: Browser Computer seat + Take control login + healthy session.  
2. **Ready** must not mean OIDC + HeyReach alone.  
3. Supervisor URL (`computerSupervisorUrl`) should point at `https://aria-mantu-computers.fly.dev` (Fly), never Vercel.  
4. Operator path: Settings → Integrations → LinkedIn stack → credentials → Fleet → Take control → login → Release.

---

## Happy path: intake → book

| Step | Expected | Actual | Break |
|---|---|---|---|
| Intake | Create campaign | Works (live or demo source) | Demo overclaims “real search” |
| Source | Fill candidates | Works under Live/Demo rules | — |
| Allocate | Seat ↔ candidate | Prefer campaign-assigned seats; Outreach CTA → `/fleet` | Still easy to miss from Campaign detail |
| Approve | Human gate | Works; dry-run can look like send | Confusing |
| Send | Live channel | Needs live seat / mailbox; LinkedIn via Browser Computer | Fails closed without seat |
| Reply | Inbound + respond | Paste classify works; sync/demo weak; UI says Queue draft reply | fixed |
| Book | Interview | Store booking; provider event optional | Emails often copy-only |

---

## Fleet / Floor / VMs (16-agent truth)

| Claim | Reality |
|---|---|
| Deploy 16 agents | Creates ≤16 **seat rows**; Fly host boots ≤ **5** Chromiums |
| Each agent has own VM | True only after `start`/`take_control` and under host cap |
| Floor shows them working | Seat count + activity + computer overlay; 3D animates ≤ device cap |
| Take control always works | Must not toast success when computer `status=error` / max computers |

**Fixes landed this pass (Fly-only code):**
- Deploy now **ensure + start** each new Browser Computer seat and reports booted vs blocked by host cap.
- Take control / computer actions **fail closed** when API returns error status.
- LinkedIn Automatic “Ready” no longer treats HeyReach-only as full automatic ready.
- Research bot UA no longer advertises the Vercel demo host.
- Fleet header shows live **Fly Chromium host** capacity (`computers/max` from `/health`).
- Roadmap IntegrationCard Configure disabled → **Coming soon** when `real: false`.
- Settings notifications: explicit **Preference only — not delivering yet**.
- Replies: **Queue draft reply** (no false send).
- Outreach: **Allocate on Fleet** link.

---

## Per-severity backlog (to Apple-level)

### P0 — blocks “feels real”
1. Raise or shard `OPENBOT_MAX_COMPUTERS` on Fly before promising 16 concurrent VMs (8GB machine today).  
2. Operator login every Browser Computer (2FA) — cannot automate.  
3. ~~Kill or clearly disable Connect on `real: false` integration cards / notification delivery theatre.~~ **done**  
4. `/api/ready` `agentFrameworks: false` — fix production agent-framework probe or stop gating on it.  
5. Keep COMPUTER_SUPERVISOR_* only on Fly app secrets (never Vercel).

### P1 — breaks seamless UX
1. ~~Allocate CTA on Outreach.~~ **done** — Campaign agents panel also has **Allocate on Fleet**  
2. ~~Rename Replies “Send reply” → “Queue draft reply”.~~ **done**  
3. ~~Applicants reject: don’t claim email send if status-only.~~ **done** (Applicant inbox confirm + toast)  
4. Schedules: hide or wire a real runner.  
5. Setup guide: complete Take-control / first-send steps from real probes.  
6. Emit `seatId` on source events when a Browser Computer ran search.  
7. After Release, probe session health (don’t fake healthy).  
8. ~~Surface host VM remaining capacity in Fleet header always.~~ **done**

### P2 — polish (Apple bar)
1. Collapse Settings density (progressive disclosure).  
2. Nav: 27 items → Operate / Analyze / System with fewer defaults.  
3. Empty states with one primary next action per page.  
4. Floor copy when agents exceed 3D cap (already partial).  
5. Consistent success toasts (what happened + what to do next).  
6. Remove remaining Vercel strings from docs / `.env.example`.

---

## Button / control honesty checklist

| Control | Honest behavior required |
|---|---|
| Deploy N | Seats created + VMs booted count + host-cap errors |
| Take control | Error toast if VM failed / at capacity |
| Release | Session probe before marking healthy |
| Connect (integrations) | Only if `real: true` + live adapter — roadmap = Coming soon |
| Test connection | Real probe or disabled |
| Dry-run toggle | Visible in chrome when on |
| Approve | Never implies delivered |
| Send | Live seat required; clear failure |
| Queue draft reply | Draft into outreach queue only — never claim delivered |
| Sync replies | Say dry-run when demo-gated |
| Fleet host strip | Always show live `computers/max` from Fly computers `/health` |

---

## Prove Apple-level on Fly (operator script)

1. Open https://aria-mantu-app.fly.dev → login.  
2. Settings → Integrations → Email OAuth (Gmail/Outlook) → Validate.  
3. Settings → LinkedIn → set supervisor URL to Fly computers → save token.  
4. Fleet → Deploy **≤5** → toast shows VMs booted (not just seats).  
5. Computers → Take control each → LinkedIn login → Release.  
6. Intake → campaign → source → allocate → approve → send.  
7. Floor → see N agents; help_requested seats show error; pulses follow `seatId`.  
8. Confirm computers health `max` ≥ desired concurrency before scaling Deploy.

---

## Decisions (don’t relitigate)

- Production LinkedIn/OpenBot = **Fly only**.  
- N seats = N Chromium profiles; Recruiter via Take control (no auto InMail).  
- Floor tangibility = assigned campaigns + live computer status + seatId pulses.  
- Host VM cap is a hard physical limit; UI must never pretend otherwise.
