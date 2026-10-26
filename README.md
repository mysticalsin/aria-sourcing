# ARIA (MSourcing)

ARIA is a recruiting operations console. It takes a hiring need and runs the
whole recruiting journey: sourcing, scoring, outreach that a human approves,
reply handling, interview booking, and reporting for decision-makers.

The repository is named MSourcing; ARIA is the product name in the UI. Some
identifiers still say `hermes` (package name, `/api/hermes/chat`, store types)
for compatibility.

## The recruiting journey

```text
Intake ─▶ Campaign ─▶ Sourcing agent ─▶ Candidates / Vivier
                                           │
           Calendar ◀─ Replies ◀─ Outreach (human approval) ◀─┘

Reporting: Command Center, Funnel, Exec, Reports, Winlog, Trust & ROI, Sessions
Public:    Careers page ─▶ Applicants inbox
```

| Step | Page | What happens |
|---|---|---|
| Intake | `/intake`, `/launch` | Paste a job description or email; ARIA parses it into a structured brief and opens a campaign (one role or a batch). |
| Sourcing | `/campaigns/[id]` | **Run agent** finds real candidates on GitHub, on the web (LinkedIn, Stack Overflow, Dribbble, Behance via Tavily) and through Apify LinkedIn search, then scores and dedupes them. |
| Candidates | `/candidates`, `/vivier` | Scored candidates with an explainable breakdown; the talent pool keeps them across campaigns. Apify can enrich a profile (email, skills, experience). |
| Outreach | `/outreach` | Drafts are generated per candidate. Nothing is sent until a human approves the exact text. Email goes out from a connected Gmail / Outlook mailbox; LinkedIn is copy/paste assisted. |
| Replies | `/replies` | Inbound replies are classified and routed for follow-up. |
| Booking | `/calendar` | Interview slots and bookings. |
| Reporting | `/`, `/funnel`, `/exec`, `/reports`, `/winlog`, `/trust`, `/sessions`, `/skills` | Candidates sourced, funnel conversion, ROI and compliance, per-candidate journeys with an audit pack, learned playbooks. |
| Careers | `/careers`, `/applicants` | A public job board; applications land in the applicant inbox. |
| Configuration | `/fleet` (Mailboxes), `/settings` | Sender mailboxes and suppression list; API keys, LLM provider, Dust and MCP servers, compliance settings. |

## Run it locally

Requirements: Docker Desktop (about 4 GB of memory for Docker is enough).

```bash
# Optional but needed to store API keys from Settings (encrypted at rest):
echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env.local

docker compose up --build
```

Open <http://localhost:3000> and sign in with `admin@hermes.local` /
`admindemo123`. The first run takes a few minutes (images, `npm ci`,
53 database migrations). [`DOCKER.md`](DOCKER.md) covers ports, resets and
troubleshooting.

### Turn on the real integrations

The stack runs without any external key. Each integration lights up when its
key is present:

| Capability | How to enable |
|---|---|
| GitHub sourcing | Works keyless (60 requests/hour). Set `GITHUB_TOKEN` in `.env.local` for 5,000/hour. |
| Web sourcing (LinkedIn, Stack Overflow, Dribbble, Behance) | Tavily key in **Settings → API keys**, or `TAVILY_API_KEY` in `.env.local`. |
| Apify LinkedIn search and enrichment | Apify token in **Settings → API keys**. |
| Sourcing agent in `cloud` mode and AI drafting | An Anthropic or OpenAI-compatible key in **Settings → API keys**, then enable it under **Settings → LLM providers**. Without it the agent runs in `deterministic` mode. |
| Email sending and reply sync | Connect a mailbox under **Mailboxes** (Gmail or Microsoft OAuth, see [`docs/runbooks/connect-gmail-outlook.md`](docs/runbooks/connect-gmail-outlook.md)), or use Resend / SendGrid. |
| Dust agents, MCP tools | **Settings → Dust agents** and **Settings → Tools** (MCP tool servers). |

Every key stored in Settings is encrypted with `DATA_ENCRYPTION_KEY` and never
returned to the browser. [`.env.local.example`](.env.local.example) lists every
variable.

## Development

To iterate on the app outside Docker, keep the backend services running and
start Next.js on the host. Copy `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`
and the anon / service-role keys from `docker-compose.yml` into `.env.local`,
then:

```bash
docker compose stop app
npm install
npm run dev
```

The quality gate every change must keep green:

```bash
npm run typecheck && npm run typecheck:tests && npm test
npm run lint
```

`npm test` runs the inventory in [`tests/test-manifest.mjs`](tests/test-manifest.mjs);
see [`docs/TESTING.md`](docs/TESTING.md).

## Stack

| Area | Technology |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind, Recharts |
| Data and auth | Self-hosted Supabase: Postgres with RLS tenancy, GoTrue, PostgREST, Kong |
| AI | Server-side calls to Anthropic or OpenAI-compatible APIs through a bounded tool loop |
| Runtime | Node 22, Docker Compose for local; internal Azure (Terraform) planned |

## Documentation

- [`docs/README.md`](docs/README.md): documentation map
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): code layout, data authority, sourcing agent, outreach
- [`docs/SOURCING.md`](docs/SOURCING.md): sourcing, scoring, enrichment, compliance
- [`SECURITY.md`](SECURITY.md): security invariants and reporting
- [`CONTRIBUTING.md`](CONTRIBUTING.md): change workflow

## Non-negotiables

- No message reaches a candidate without a recorded human approval of the exact text.
- LinkedIn is never automated: no login automation, scraping, or rate-limit bypass.
- Provider credentials stay server-side and encrypted at rest.
