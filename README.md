# Hermes Sourcing

**An industrial-grade autonomous recruiting operations console.**

Hermes turns inbound job requests into booked interviews: it parses a job
description from an email, builds a sourcing campaign, finds and scores synthetic
candidates, drafts personalized outreach, processes replies, books interviews
with mock Cal.com / Outlook / Teams links, logs everything, and proposes weekly
skill improvements.

> **Human approval. Machine speed.** This is a runnable MVP/demo. Every
> integration runs in **mock mode**, all data is **synthetic**, and all outreach
> is **dry-run** by default — nothing is ever actually sent.

### Agent fleet, learning skills & confidentiality

- **Agent fleet (`/fleet`)** — run **multiple coordinated Hermes agents**, each a
  real, authorized sending seat (Microsoft Graph / Gmail / SendGrid / Resend via
  official APIs). A shared **outreach ledger + suppression list** guarantees no
  candidate is ever contacted twice across the whole fleet. Anti-ban guardrails:
  per-account daily caps, **warm-up ramps**, send windows, human-paced jitter,
  global re-contact window, and **auto-pause** on bounce/complaint spikes. This is
  team coordination *within* each platform's official limits — **never** scraping,
  LinkedIn automation, or rate-limit evasion. LinkedIn stays assisted-manual.
- **Learning skills (`/skills`)** — the four Hermes skills (outreach / sourcing /
  scoring / reply-classification) are versioned, editable playbooks. **Run
  learning** analyses real outcomes (which tone converted, which score dimension
  predicted interest, the reply mix) and proposes concrete changes; accepting one
  bumps the skill version and **feeds back into behavior** (tone, scoring weights,
  classification thresholds).
- **Humanizer — always on.** Every generated message is run through the Humanizer:
  it strips AI tells (em-dashes, "leverage/robust/seamless/delve", filler phrases)
  before anything is shown or sent. No AI slop, ever. Per-agent **editable prompts**
  set each agent's voice in Settings → the Humanizer still cleans the output.
- **Candidate confidentiality.** PII is **purpose-limited to outreach**. With
  confidentiality mode on, names/emails/profiles are masked everywhere except an
  active outreach context, and any reveal is written to the audit trail.

### Two run modes

- **Demo mode (default)** — no setup. State persists to `localStorage`, the app is
  open, no login.
- **Live mode** — set the Supabase env vars and the console runs on a real
  backend: state persists to **Supabase** in a shared **org workspace** (RLS by
  email domain) and the whole app is gated behind **Microsoft (Entra) sign-in**.
  Flip modes with env vars only — no code changes. Full guide:
  **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** (`cp .env.local.example .env.local`).

---

## 1. Install & run

```bash
npm install
npm run dev
```

Open **http://localhost:3000**.

Other scripts:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

Requirements: Node 18.18+ (tested on Node 22). No database, no API keys, no
network calls required — demo state is seeded and persisted to **localStorage**.

---

## 2. Demo flow (the golden path)

1. **Command Center (`/`)** — review live KPIs, the sourcing funnel, active
   campaigns, integration health, and the "Attention needed" panel.
2. **Intake (`/intake`)** — click **"Load sample urgent backend role"**, then
   **Parse JD**. Review the structured `JobAnalysis`, confidence badges, and
   validation warnings. Edit any field, then **Create Campaign**.
3. **Campaign detail (`/campaigns/[id]`)** — click **Source next batch** to
   generate scored candidates (dedupe rules skip duplicates / excluded / current
   companies). Explore the tabs: JD Analysis, Sourcing Strategy, Candidates,
   Outreach, Replies, Booking, Learning.
4. **Candidate (drawer)** — open a candidate to see the score gauge, weighted
   score breakdown, source query, history, and compliance controls.
5. **Generate outreach** — from a candidate, draft a personalized message. It
   lands in the **Outreach** approval queue.
6. **Approve message (`/outreach`)** — tune the tone, edit inline, then
   **Approve**. The gate blocks candidates under the score floor or over the
   daily rate limit. Approved messages become *"Approved / Dry-run scheduled"*
   and the candidate moves to **Contacted** — nothing is sent.
7. **Classify reply (`/replies`)** — paste a reply (or use a sample) and watch
   Hermes classify intent, confidence, and the recommended next action with a
   drafted response.
8. **Book interview (`/calendar`)** — book an interested candidate. Hermes
   assigns an interviewer round-robin and generates mock Cal.com + Teams links
   plus interviewer-prep and candidate-confirmation emails.
9. **Weekly report (`/reports`)** — generate the funnel + performance report,
   export it as Markdown, and accept/reject proposed **skill updates**
   (outreach / sourcing / scoring / reply-classification).

Use **⌘K** anywhere for the command palette. The user menu has **Reset demo
data** to restore the seed.

---

## 3. Mock-integration philosophy

Hermes is **production-shaped but safe by default**:

- **No real scraping, sending, LinkedIn automation, or enrichment calls.** Every
  external system is an adapter stub in mock mode (`src/lib/integrations.ts`).
- **Synthetic data only** — candidate names, companies, and emails are generated
  (`*.example` domains) in `src/lib/seed.ts` / `src/lib/mock-ai.ts`.
- **Dry-run + human-approval gate are ON** by default. No candidate is contacted
  without explicit approval, and approval never triggers a real send.
- **Platform terms are respected** — no bypassing login walls, rate limits, or
  privacy restrictions. Daily caps (15 emails / 20 LinkedIn DMs) are enforced and
  visualised.
- **Compliance built in** — GDPR export/anonymize, suppression, do-not-contact,
  unsubscribe enforcement, retention windows, CCPA "do not sell".

The deterministic "AI" pipeline lives in `src/lib/mock-ai.ts`
(`parseEmailAndJD`, `sourceCandidates`, `generateOutreach`, `classifyReply`,
`createBooking`, `generateWeeklyReport`, …) and the scoring in
`src/lib/scoring.ts`. Business rules (approval gate, dedupe, rate limits, SLA) are
in `src/lib/rules.ts`.

---

## 4. Where to plug in real APIs later

The app is architected so a real backend can be wired without touching the UI:

| Concern | Demo (now) | Production (later) |
| --- | --- | --- |
| Persistence | `localStorage` via `src/lib/store.ts` | **Supabase (built-in)** — `workspace_state` doc per org, RLS; see SUPABASE_SETUP.md |
| Auth | none (open demo) | **Microsoft / Entra via Supabase Auth (built-in)** — middleware-gated |
| CRM | mock activities | Twenty CRM adapter |
| Inbox / parsing | `parseEmailAndJD()` heuristics | Microsoft Graph + an LLM parser |
| Sourcing | `sourceCandidates()` synthetic gen | GitHub / LinkedIn official partner APIs |
| Scoring | `scoreCandidate()` | Resume Matcher API |
| Enrichment | none | Apollo / Hunter / Clearbit (official APIs) |
| Email send | dry-run | SendGrid / Resend (gated behind the dry-run flag) |
| Scheduling | mock links | Cal.com + Microsoft Graph / Teams |
| Notifications | in-app toasts | Slack / Telegram |

Each integration card in **Settings** carries a `mode: mock | live` flag and a
"test connection" stub — the seam where real credentials and clients attach.

---

## 5. Architecture

```
src/
  app/                 # routes (App Router) — all pages are client components
  components/
    ui/                # design-system primitives (Button, Badge, Drawer, …)
    app/               # shell (AppShell, Sidebar, TopBar, CommandSearch, nav)
    charts/            # recharts wrappers (funnel, gauge, distribution, …)
    dashboard/ shared/ campaigns/ candidates/ outreach/ replies/ calendar/
    settings/ reports/ # feature components
  lib/
    types.ts           # domain model (single source of truth)
    store.ts           # React context + actions + localStorage persistence
    seed.ts            # synthetic world (3 campaigns, ~52 candidates, …)
    mock-ai.ts         # deterministic parse/source/outreach/classify/report
    scoring.ts metrics.ts rules.ts integrations.ts utils.ts
  styles/globals.css   # design tokens + base styles
```

**Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Recharts,
lucide-react, Framer Motion, Zod. Mantu-inspired editorial UI — original Hermes
identity, no third-party brand assets.

---

_Hermes Sourcing · synthetic data · dry-run mode · built for demonstration._
