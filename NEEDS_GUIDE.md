# Giving Aria a need — and getting sourcing started

This is the operator's guide to feeding a hiring **need** into Aria Sourcing (manually, by email, or by webhook) and having the platform start sourcing candidates for you.

Verified end-to-end on 2026-07-06 against the local Docker stack.

---

## TL;DR — the three ways in

| How | Where | What happens |
|---|---|---|
| **Paste it** | `/intake` → paste the need email → **Parse JD** → **Create campaign** | Campaign is created **and the first real sourcing batch runs automatically**. |
| **Email it** | Send the need email to a connected mailbox → `/intake` → **Scan inbox** | Aria pulls the mailbox, finds the newest need email, parses it. You review, click **Create campaign**, sourcing starts. |
| **Webhook** | `POST /api/intake` with `{ email }` or `{ from, subject, body }` | Returns the structured brief as JSON (parse-only — campaign creation stays human-gated in the app). |

Every path keeps the human-approval gate: **no candidate is ever contacted without your explicit sign-off** on the outreach.

---

## 1. Where to run it

### A. Local Docker stack (recommended for real use)

```bash
cd MSourcing
docker compose up --build          # app + its own Supabase (Postgres, GoTrue, PostgREST, Kong)
```

- App: **http://localhost:3003** (mapped from container port 3000; override with `APP_PORT`)
- Sign in: **admin / admin** (or `admin@hermes.local` / `admindemo123`)
- Supabase API on `:54321`, Postgres on `:54322` — stop any host `supabase start` first to avoid port clashes.
- The app container bind-mounts this repo and runs `npm run dev`, so **code edits are live** without a rebuild. Only rebuild (`docker compose build app`) after dependency changes.
- `docker compose down` keeps your data; `down -v` wipes and re-seeds.

### B. Public Vercel demo

- **https://aria-sourcing-demo.vercel.app** — sign in **admin / admin**.
- Runs against hosted Supabase; all demo users share one workspace.
- Deploy runbook: `DEPLOY_VERCEL_DEMO.md` (production branch is `vercel-demo`).

### C. Bare local dev

```bash
npm install && npm run dev         # http://localhost:3000
```

- With no Supabase env vars: open demo mode (localStorage persistence, no login).
- Note: this repo's `.env.local` points at a local Supabase on `127.0.0.1:54321` — if the Docker stack (or `supabase start`) isn't running, you'll be stuck at the login gate. Either start the stack or blank the `NEXT_PUBLIC_SUPABASE_*` vars.
- On this OneDrive checkout, set `NEXT_DIST_DIR` to a non-synced path or `.next` gets corrupted mid-write.

---

## 2. Give a need manually

1. Open **Intake** (`/intake`).
2. Paste the hiring request / need email into **Recruiter email / brief** (the `From:` line and signature improve extraction). Optionally paste the JD below it.
   - The Mantu/Amaris *"This need is now ACTIVE"* format is detected and parsed with a dedicated structured parser (client, manager, recruiter, priority, location, start date, languages, skills).
3. Click **Parse JD** → the structured, editable brief appears (title, skills, salary, seniority, confidence per field, validation warnings, clarification-email draft for gaps).
4. Fix anything the parser missed — warnings recompute live.
5. Click **Create campaign** → the campaign is created with a sourcing strategy **and the first sourcing batch starts immediately** (you'll land on the campaign page and see candidates arrive). Duplicate needs (same title + hiring-manager email) raise a confirm dialog first.

From the campaign page you can keep going:

- **Source next batch** — pulls the next batch from the lead platform.
- **Run sourcing agent** — LLM tool-calling loop: searches, scores, and drafts outreach in one pass (needs a cloud LLM key, see §5).
- **Review outreach** — approve/edit every message before anything could send. Dry-run mode is on by default: nothing sends, ever, until a sending domain is connected and verified.

---

## 3. Give a need by email

### One-time setup (mailbox connect)

Email intake reads a real mailbox via OAuth (Gmail API or Microsoft Graph), **read-only** — it never sends, marks read, or deletes.

Requirements (all three, live/Supabase mode only):

1. **OAuth app credentials** in the environment:
   - Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and register the redirect URI `https://<your-host>/auth/google/callback` (defaults to `http://localhost:3000/auth/google/callback` — for the Docker stack set `GOOGLE_REDIRECT_URI=http://localhost:3003/auth/google/callback`).
   - Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` likewise.
2. **`DATA_ENCRYPTION_KEY`** — tokens are encrypted at rest; in production the OAuth callback refuses to store tokens without it.
3. **Connect the mailbox**: go to **Agent Fleet** (`/fleet`), pick a seat, and connect Gmail / Outlook from the seat card (admin only). Tokens land encrypted in the `email_connections` table.

Put the env vars in `.env.local` (Docker passes it through) or the Vercel dashboard, then restart.

### Day-to-day flow

1. Send (or forward) the need email to the connected mailbox — the Mantu *"need is now ACTIVE"* format is recognized automatically; generic emails are recognized when the subject looks like a hiring request (e.g. contains "job description", "new role/position/need/vacancy/opening", "hiring request", "backfill", "open position").
2. Open **Intake** → click **Scan inbox**.
   - Aria syncs the mailbox (last 14 days, capped at 50 messages), picks the **newest need email**, loads and parses it. The toast tells you if more need emails are waiting.
   - If nothing qualifies (or no mailbox is connected), it says so and loads the bundled sample instead — you'll never mistake demo data for a real scan.
3. Review the brief → **Create campaign** → sourcing starts automatically (same as §2).

Synced emails that are candidate **replies** (not needs) belong on the **Replies** page — its own **Sync inbox** button classifies them by intent (interested / not interested / OOO / referral …).

### What is (deliberately) not automated

There is **no background poller**: nothing reads your mailbox or spends API credits unless a signed-in user clicks Scan/Sync. Schedules configured in Settings persist as intent but need a backend cron runner (not wired) to fire on their own. So "email → sourcing" is: **send the email, open Intake, click Scan inbox, click Create campaign** — two clicks, everything else is automatic, and parsing/creation never contacts anyone by itself.

---

## 4. Give a need by webhook (`/api/intake`)

For n8n / Zapier / Microsoft Graph subscriptions:

```bash
curl -X POST https://<host>/api/intake \
  -H 'Content-Type: application/json' \
  -d '{"from":"hm@client.example","subject":"NEED: Murex Support","body":"<the need email text>"}'
```

Returns `{ ok, format: "mantu-need"|"generic", parsed: <JobAnalysis…>, suggestedMeta }`. It **parses only** — it does not create the campaign (that stays a human decision in the app). Auth: requires a signed-in session in live mode; rate-limited to 10/min.

---

## 5. The sourcing engines and which keys unlock what

| Engine | Trigger | Backend | Key needed |
|---|---|---|---|
| **GitHub batch** | auto-run on create / "Source next batch" (GitHub platform) | GitHub Users Search API (read-only, public profiles) | None (60 req/hr per IP). `GITHUB_TOKEN` raises it to 5,000/hr — recommended. |
| **Web batch** (LinkedIn, Stack Overflow, Dribbble, Behance) | "Source next batch" (those platforms) | `site:`-scoped web search | **`TAVILY_API_KEY` strongly recommended.** The keyless fallback is DuckDuckGo's Instant-Answer API, which returns ~zero results for people searches — without Tavily these platforms will come back empty. |
| **Sourcing agent** | "Run sourcing agent" | LLM tool-calling loop over the same real search + scoring | A cloud LLM key configured for the *sourcing* task in Settings → AI: Anthropic / OpenAI / Groq / xAI / Mistral. **Kimi and the Hermes bridge don't support tool-calling** and are rejected for this task. |
| **Run Aria / Launch war room / Talent Pool / Referral** | those buttons | Deterministic synthetic candidates (cinematic demo) | None — by design, zero network. |

Real batches are authoritative: zero real hits is reported as zero, never backfilled with synthetic profiles. All results are scored deterministically against the campaign's weights (editable per campaign, learns from your feedback).

---

## 6. Troubleshooting

- **"Sourcing started — 0 candidates"** on a LinkedIn-family platform → set `TAVILY_API_KEY` (see §5). On GitHub → you may have hit the anonymous 60/hr rate limit; set `GITHUB_TOKEN`.
- **Chat / live parse falls back to heuristic** — the bundled Kimi key returns **401 (dead/rotated)** as of 2026-07-06. Parsing still works (regex heuristic); set a valid key in Settings → AI or the `KIMI_API_KEY` env to restore LLM-upgraded parsing, or configure Anthropic/OpenAI for the *chat* task.
- **Stuck at login locally** → the app is in live mode but its Supabase isn't running (see §1C).
- **`aria-sourcing-rest-1` shows unhealthy** → fixed 2026-07-06 (`PGRST_ADMIN_SERVER_PORT` added to `docker-compose.yml`); recreate with `docker compose up -d rest`.
- **Scan inbox always loads the sample** → no mailbox connected (§3 setup), or the need email's subject doesn't match the recognizer — resend with a subject like `NEED: <role>` or just paste it (§2).
- **Edits don't show up on :3003** → the container dev server hot-reloads from this repo; hard-refresh the browser. Rebuild only after `package.json` changes.
- **Deploying to prod** → push to the `vercel-demo` branch and verify the deployment's readyState (not just the push) — see `DEPLOY_VERCEL_DEMO.md`.
