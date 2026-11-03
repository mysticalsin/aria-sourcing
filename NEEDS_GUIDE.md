# Giving Aria a need — and getting sourcing started

This is the operator's guide to feeding a hiring **need** into Aria Sourcing (manually, by email, or by webhook) and then sourcing candidates for it.

Reviewed 2026-11-03 against the code (routes in `src/app`, nav in `src/components/app/nav.ts`, `.scratch/unified-sourcing/spec.md`); not browser-verified.

---

## TL;DR — the ways in

| How | Where | What happens |
|---|---|---|
| **Paste it** | **New campaign** (`/campaigns/new`, mode **One role**) → paste the need email → **Parse JD** → **Create campaign** | The campaign is created with an editable brief. **No paid sourcing starts.** You land on the campaign page and start sourcing yourself (§2). |
| **Several roles at once** | `/campaigns/new?roles=several` (mode **Several roles**) | One campaign per role. In live mode each campaign waits for its own source review; in demo mode the roles are sourced in parallel with synthetic data. |
| **Email it** | Send the need email to a connected mailbox → **New campaign** → **Scan inbox** | Aria pulls the mailbox, finds the newest need email and parses it. You review and click **Create campaign**. |
| **Hand it a person** | Campaign page → **Add candidate** | Two modes: a **GitHub username** (fetches the public profile via the GitHub API) or a **manual entry**. The person lands as a scored candidate in the campaign; no search runs and no outreach is drafted. |
| **Webhook** | `POST /api/intake` with `{ email }` or `{ from, subject, body }` | Returns the structured brief as JSON (parse-only; campaign creation stays human-gated in the app). |

`/intake` redirects to `/campaigns/new` and `/launch` redirects to `/campaigns/new?roles=several` (`next.config.mjs`).

Every path keeps the human-approval gate: **no candidate is ever contacted without your explicit sign-off** on the outreach.

### Where things are in the nav

| Group | Entries |
|---|---|
| Home | Home (`/`, today's action queue) |
| Recruit | Campaigns, Candidates (tabs: All candidates, Applicants, Talent pool), Pipeline (`/funnel`) |
| Engage | Outreach, Replies, Calendar |
| Analyze | Reports (tabs: Overview `/exec`, Learning loop `/reports`, Wins `/winlog`, Trust & ROI `/trust`), AI costs (`/costs`) |
| System | Mailboxes (`/fleet`), Skills, History (`/sessions`), Settings |

**New campaign** sits above the groups in the sidebar and is also reachable from Home, the Campaigns page and the command search.

---

## 1. Where to run it

### A. Local Docker stack (recommended)

```bash
docker compose up --build          # app + its own Supabase (Postgres, GoTrue, PostgREST, Kong)
```

- App: **http://localhost:3000** (override with `APP_PORT`).
- Sign in: `admin@hermes.local` / `admindemo123` (local-only sample from `docker/bootstrap/run.sh`; `DEMO_ADMIN_PASSWORD` overrides it).
- Supabase API on `:54321` (`KONG_PORT`), Postgres on `:54322` (`DB_HOST_PORT`). Stop any host `supabase start` first to avoid port clashes.
- The app service runs a built production image, so code changes need `docker compose up --build`. See `DOCKER.md` for details.
- `docker compose down` keeps your data; `down -v` wipes it and the next `up` re-seeds.

### B. Bare local dev

```bash
npm install && npm run dev         # http://localhost:3000
```

- With no Supabase env vars: demo mode (localStorage persistence, no login, synthetic sourcing).
- If `.env.local` points at a local Supabase on `127.0.0.1:54321` and nothing is listening there, you'll be stuck at the login gate. Start the stack or blank the `NEXT_PUBLIC_SUPABASE_*` vars.
- On a OneDrive checkout, use `npm run build:isolated`. It copies only the application build inputs to a temporary directory, installs from `package-lock.json`, and runs the standard build there. Do not set an absolute `NEXT_DIST_DIR`: Turbopack does not support output outside its project root.

---

## 2. Give a need manually

1. Open **New campaign** (`/campaigns/new`), mode **One role**.
2. Paste the hiring request / need email into **Recruiter email / brief** (the `From:` line and signature improve extraction). Optionally paste the JD into **Job description (optional)**. **Sample backend role** and **Load Mantu need** load bundled examples.
   - The Mantu/Amaris *"This need is now ACTIVE"* format is detected and parsed with a dedicated structured parser (client, manager, recruiter, priority, location, start date, languages, skills).
3. Click **Parse JD** → the structured, editable brief appears (title, skills, salary, seniority, confidence per field, validation warnings, clarification-email draft for gaps).
4. Fix anything the parser missed; warnings recompute live. Critical warnings block creation.
5. Click **Create campaign** → you land on the campaign page. Duplicate needs (same title + hiring-manager email on a campaign that is not Filled) raise a confirm dialog first.

**Creating a campaign does not start paid sourcing.** From the campaign page:

- **Live mode (Supabase / Docker stack): Run sourcing** opens the source review. Pick LinkedIn (Apify) and/or GitHub, review the queries and set an explicit profile limit per source, then start one durable run. LinkedIn runs first when selected; GitHub is a separate complementary step. Progress shows persisted found/added/duplicate/excluded counts; refreshing resumes the same run and never launches a second paid actor. Missing provider configuration is reported, never silently replaced by another source.
- **Demo mode (no Supabase): Run Aria**, **Source next batch** and **Run sourcing agent** are shown instead. The first two produce synthetic candidates; the sourcing agent runs the Claude tool loop over real search tools, or only the reviewed GitHub queries when no model key is available (§5).
- **Review outreach** — approve/edit every message before anything could send. Nothing sends until the live-sending conditions in §6 are all met.

Sourcing buttons are disabled until the campaign status is Sourcing or Outreach.

---

## 3. Give a need by email

### One-time setup (mailbox connect)

Email intake reads a real mailbox via OAuth (Gmail API or Microsoft Graph), **read-only**: it never sends, marks read, or deletes.

Requirements (live/Supabase mode only):

1. **OAuth app credentials** in the environment:
   - Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (register `http://localhost:3000/auth/google/callback`, or your host's equivalent).
   - Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` likewise.
2. **`DATA_ENCRYPTION_KEY`** — tokens are encrypted at rest; the OAuth callback refuses to store tokens without it.
3. **Connect the mailbox**: go to **Mailboxes** (`/fleet`), pick a seat, and connect Gmail / Outlook from the seat card (admin only). Tokens land encrypted in the `email_connections` table.

Put the env vars in `.env.local` (the Docker app service reads it if present), then restart.

### Day-to-day flow

1. Send (or forward) the need email to the connected mailbox. The Mantu *"need is now ACTIVE"* format is recognized automatically; generic emails are recognized when the subject looks like a hiring request (e.g. "job description", "new role/position/need/vacancy/opening", "hiring request", "backfill", "open position").
2. Open **New campaign** → click **Scan inbox**.
   - Aria syncs the mailbox (capped at 50 messages), picks the **newest need email**, loads and parses it. The toast tells you if older need emails are waiting.
   - In live mode, if nothing qualifies it says "No hiring need found" and substitutes nothing. Only demo mode falls back to the labelled bundled sample.
3. Review the brief → **Create campaign** → start sourcing from the campaign page (§2).

Candidate **replies** belong on the **Replies** page: **Triage inbox** syncs the mailbox, classifies new replies by intent and drafts responses for approval.

### What is (deliberately) not automated

There is **no background poller**: nothing reads your mailbox or spends API credits unless a signed-in user clicks Scan inbox / Triage inbox. So "email → sourcing" is: **send the email, open New campaign, Scan inbox, Create campaign, Run sourcing.** Parsing and creation never contact anyone by themselves.

---

## 4. Give a need by webhook (`/api/intake`)

For n8n / Zapier / Microsoft Graph subscriptions:

```bash
curl -X POST https://<host>/api/intake \
  -H 'Content-Type: application/json' \
  -d '{"from":"hm@client.example","subject":"NEED: Murex Support","body":"<the need email text>"}'
```

Returns `{ ok, format: "mantu-need"|"generic", parsed: <JobAnalysis…>, suggestedMeta }`. It **parses only**: it does not create the campaign. Auth: requires a signed-in session in live mode; rate-limited to 10/min.

---

## 5. Sourcing engines, AI, and which keys unlock what

| Engine | Trigger | Backend | Key needed |
|---|---|---|---|
| **LinkedIn (Apify)** | **Run sourcing** source review (live mode) | Apify LinkedIn profile search actor, durable run with per-workspace quotas | Apify key connected in **Settings**. |
| **GitHub** | **Run sourcing** source review (live mode) | GitHub Users Search API (read-only, public profiles) | None (60 req/hr per IP). `GITHUB_TOKEN` raises it to 5,000/hr. |
| **Web search** (LinkedIn, Stack Overflow, Dribbble, Behance via `site:`) | Sourcing agent web tool | Tavily web search | `TAVILY_API_KEY`. |
| **Sourcing agent** | **Run sourcing agent** (shown in demo mode) | Claude tool-calling loop over the search + scoring tools; rule-based fallback without a key | Anthropic key (below). |
| **Run Aria / Source next batch / multi-role demo** | demo mode only | Synthetic candidates (Talent Pool); a browser-local demo cannot persist real candidates | None. |

**AI runs on Claude via the single Anthropic key.** Anthropic is the default enabled provider. The key comes from the workspace vault (**Settings**), or on a developer machine from `ANTHROPIC_API_KEY` in the server environment or the gitignored `.secret` file at the repo root. Brief parsing, reply classification, drafting and the sourcing agent use it; spend per activity is on **AI costs** (`/costs`). Without a key, parsing and the agent fall back to rule-based behaviour with a visible warning.

Real batches are authoritative: zero real hits is reported as zero, never backfilled with synthetic profiles. Results are scored deterministically against the campaign's weights.

---

## 6. From approved outreach to a real inbox (live sending)

Everything is dry-run until ALL of these are true (each is checked server-side):

1. Live/Supabase mode and a signed-in `admin`/`member`.
2. A **send provider**: `RESEND_API_KEY` or `SENDGRID_API_KEY`, or a connected Gmail/Graph mailbox seat.
3. The seat's **sending domain verified** — click **Verify domain** on the seat card (Mailboxes): it runs a real SPF/DMARC/DKIM DNS check and persists the result. No DNS records → no send.
4. The seat toggled **Live**.
5. The exact message **human-approved** (the server stores a hash of the approved subject+body; editing after approval invalidates it).
6. `OUTREACH_UNSUBSCRIBE_BASE_URL` is set to a canonical HTTPS app origin and every migration is applied. Every live email gets a recipient-specific opaque one-click link, standard headers, and a visible footer.
7. Recipient not suppressed, within re-contact windows and the seat's daily/warm-up caps (enforced atomically in Postgres).

Before real volume, run a controlled unsubscribe smoke test: send to a mailbox you own, inspect raw headers, submit the one-click POST, and prove a later send is blocked.

## 7. Interviewers & booking

The interviewer roster is editable on `/calendar` (admin): add real names/emails, deactivate or remove people; bookings round-robin over **active** interviewers. With a live Gmail/Graph seat + Supabase, bookings create real calendar events (`/api/calendar/event`); otherwise they stay dry-runs with no fake meeting links. Replace the seeded demo interviewers with real staff before going live.

## 8. Troubleshooting

- **Run sourcing reports a missing provider** → connect the Apify key in Settings (LinkedIn) or deselect that source. On GitHub, 0 results may mean the anonymous 60/hr rate limit; set `GITHUB_TOKEN`.
- **Parse falls back to heuristic / "Brief extracted for review"** → no usable Anthropic key; add it in Settings or set `ANTHROPIC_API_KEY` / `.secret` (§5).
- **Sourcing buttons disabled** → move the campaign to Sourcing or Outreach.
- **Stuck at login locally** → the app is in live mode but its Supabase isn't running (see §1B).
- **Scan inbox says "No hiring need found"** → no mailbox connected (§3 setup), or the need email's subject doesn't match the recognizer. Resend with a subject like `NEED: <role>` or just paste it (§2).
- **Code changes don't show on :3000 in Docker** → the app container runs a built image; rerun `docker compose up --build`.
