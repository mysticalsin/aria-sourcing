# Real sourcing test on the other machine

Operator checklist, prepared 2026-10-27. Run this on the machine hosting ARIA's
connected local Docker stack. No Azure deployment is needed.

This guide contains no private account identifiers, API tokens or provider run
identifiers. Keep those in a password manager or the application's encrypted vault.

## 1. What must be available

| Item | Required for this test? | Configuration |
|---|---|---|
| Repository | Yes | Latest `mbe-branch` (Apify removed on 2026-11-06). |
| Docker and Compose | Yes | Docker Engine/Desktop running; Compose 2.24 or newer. On Windows, use Docker Desktop's supported virtualization backend. |
| Browser | Yes | Open the application **on the Docker machine**. The default ports bind to loopback. |
| Local ports | Yes | App `3000`, Supabase API `54321`, database `54322` free, or the overrides below. |
| Network | Yes | Image/dependency downloads during build; outbound HTTPS to `api.anthropic.com` and `api.github.com` for the selected sources. |
| Workspace administrator | Yes for setup | A connected admin session to save the workspace's Anthropic key and check connections. |
| GitHub token | Optional | Start with public anonymous access for a small test. If needed, set server-only `GITHUB_TOKEN` in the machine's ignored `.env.local`. |
| Anthropic key | Yes for "LinkedIn via web search" | Save it under **Settings -> API keys** (provider Anthropic) and select it on the Anthropic provider in **Settings -> AI & Models**. Web search must be enabled for the Anthropic organization (Claude Console -> Settings -> Capabilities). GitHub needs no model. |
| Tavily, local LLM | No | Not used by the reviewed campaign search. |
| Mailbox, SMTP, calendar, Azure | No | Leave these out of the sourcing test. No candidate message is sent. |
| Host Node / Supabase CLI | No for normal Docker use | Node 22 is only needed for optional host-side helpers/automated acceptance. |

The standard stack has five permanent services (`app`, `db`, `auth`, `rest`,
`gateway`) and two initialization jobs. An exited initialization job with exit code
zero is expected. No separate worker or model container is required.

## 2. Update and start without losing existing data

In the repository on the other machine:

```bash
git status --short
```

If there are local changes, reconcile them before switching/updating; do not
reset or discard them. With a clean checkout:

```bash
git switch mbe-branch
git pull --ff-only origin mbe-branch
git rev-parse --short HEAD
docker compose version
docker compose up --build --detach --wait --wait-timeout 300
docker compose ps --all
```

Keep the existing Compose project name and checkout location when updating an
existing installation. A different project name can select different volumes
and appear to lose the workspace. Do not use a new `-p` value for this test.

Compose configures the local Supabase URLs and local service credentials; there
is no need to fill in every variable in `.env.local.example`. Initialization
applies forward migrations, including the sourcing migrations. Never reset the
database to apply an update.

Preserve **both `db_data` and `app_config` volumes**. The app generates its
credential encryption key in `app_config` on first startup if none was supplied.
If this installation already has `DATA_ENCRYPTION_KEY` in `.env.local`, retain
that exact value. Back up the database and its encryption key together.

Do not run `docker compose down -v`, remove volumes, run `supabase db reset`, or
replace the encryption key as a troubleshooting shortcut.

### Only if the default ports are occupied

Set these non-secret overrides in the repository's local `.env`, preserving any
existing settings:

```dotenv
APP_PORT=3101
API_PORT=54331
DB_HOST_PORT=54332
```

Then run the same `docker compose up --build ...` command. Use
`http://localhost:3101/login` instead of port 3000. Public URLs, Auth callbacks
and the browser configuration must agree; rebuilding is required after changing
these ports. Keep loopback bindings for this local test.

## 3. Verify the connected workspace

1. Open `http://localhost:3000/login` (or the overridden app port) on the Docker
   machine. Default local sample login: `admin@aria.local` / `admindemo123`;
   use the existing login if its password was changed.
2. Check `http://localhost:3000/api/ready` returns HTTP 200. This checks backend
   dependencies and migration state; `/api/health` alone only proves liveness.
3. As an administrator, open **Settings -> Workspace -> Check connections**.
   Resolve any blocked core backend/encryption dependency before adding keys.
   Optional integrations may remain missing.
4. Confirm this is the persisted connected workspace. The no-backend
   `npm install && npm run dev` quick-look showcase uses synthetic browser data;
   it is not the environment for saving real provider keys or testing discovery.

`localhost` refers to the machine running the browser. This stack cannot be
configured remotely from another computer through its loopback URL.

## 4. Configure the Anthropic key safely

In **Settings -> API keys**, as an admin:

1. Set a descriptive label, select provider **Anthropic**, and paste the key
   into the password field.
2. Click **Save key**. The backend encrypts it; only masked metadata should return
   to the browser. Confirm it remains listed after a refresh.
3. In **Settings -> AI & Models**, select that key on the Anthropic provider.
   "LinkedIn via web search" uses this workspace key, not an environment variable.
4. **Format check** checks syntax only. A `valid` badge does not prove the key
   has credits or that web search is enabled for its organization.

Save the key in the intended workspace rather than adding it to Compose, code, a
script, Git, terminal arguments or a `NEXT_PUBLIC_*` variable.

Each web search costs $0.01 plus tokens; one run makes 2 to 5 searches. The
spend counts under "Web search sourcing" on **AI costs** and within the AI
budget. When the budget is reached, the source review refuses web search before
any run is created.

## 5. Run one small reviewed search

1. Create or open a dedicated test campaign. Creating it must not start a search.
2. Review the brief: role/title, required skills, seniority, location, work mode
   and employment type. Resolve the readiness prompts and move the campaign to
   **Sourcing**. Use a real, coherent brief rather than filling fields at random.
3. Example brief: Backend Go engineer, Go and Kubernetes, France; explicitly
   choose the applicable seniority, work mode and full-time employment type.
4. In **Find candidates**, inspect the proposed source queries. For a small
   example, the web search text can be `Go Kubernetes`; GitHub can use
   `language:go location:France`. Review each against the intended brief; matching
   a search filter is not proof that an individual has a skill.
5. Select **LinkedIn via web search**. Optionally select **GitHub public
   profiles** as well. Set **Maximum profiles per selected source**
   to **3**: one source requests at most 3 profiles; two request at most 6 in total.
6. Click **Start reviewed search** once. Web search returns public profile
   results (name, headline, link); it never returns email addresses.
7. Observe the persisted source states and `found / added / duplicates / excluded`
   counters. A source may return fewer than the requested cap. Missing email or
   experience is expected when the source does not provide it.
8. Refresh while processing and return to the same campaign with the initiating
   user. The same run should resume; later steps wait until the page is open
   again.
9. If a web search is marked uncertain (interrupted before its results were
   saved), it was billed and is never retried automatically. Inspect the saved
   run before any replacement. Do not start another
   paid search merely because progress is slow or the result is empty.

Keep this test at discovery/review. Do not connect a mailbox or approve/send
outreach as part of it.

## 6. Validate results, persistence and deduplication

- **Result honesty:** distinguish a genuine completed empty search from a
  provider refusal or source error. If web search fails and GitHub succeeds,
  the run should report partial success and retain GitHub results.
- **Real profiles:** open **Review saved candidates**. Confirm actual new records
  belong to the intended campaign/workspace. Follow their source links through
  the application's authorized candidate review; respect confidentiality mode.
- **Evidence:** compare a few saved fields with their source. Unknown email,
  skills or years of experience must remain unknown. Requested skills must not
  appear as observed evidence merely because they were in the search query.
- **Next action:** a candidate without email should direct the recruiter toward
  contact discovery/review rather than implying the candidate is ready to email.
- **Refresh:** reload the browser and check candidates, source counts and history
  persist. A new browser session should not invent additional candidates.

Then stop/start the normal stack, keeping the same project and volumes:

```bash
docker compose down
docker compose up --detach --wait --wait-timeout 300
```

Sign in again. Check the campaign, candidates, run history and masked Anthropic
key remain present. Key presence alone does not prove decryption: check the workspace
diagnostics for encryption errors. The next deliberately authorized provider use
must also succeed; do not launch a paid run just to check that the key is listed.

Only after reviewing the first result and its cost, optionally authorize a
second small search to test deduplication. Repeated source identities should
count as duplicates rather than produce duplicate records. A live provider may
return different people on a later request; new people are not a dedupe failure.
Do not merge people solely because they share a name.

## 7. Troubleshooting

| Symptom | Check / next action |
|---|---|
| Startup/readiness fails | Inspect `docker compose ps --all` and locally inspect `docker compose logs --tail=100 app supabase-bootstrap db`. Resolve the reported dependency/migration error; retain volumes. Redact logs before sharing. |
| Login or browser backend calls fail after changing ports | Verify the browser is on the Docker machine, ports in `.env`, then rebuild with the normal start command. Do not mix hosted Supabase URLs into the default Compose setup. |
| Key appears saved but vanishes or the UI mentions session/demo storage | Check that you are using connected Docker/Supabase, the intended workspace and an admin session. The synthetic quick look is insufficient. |
| "Add an Anthropic key in Settings" on the source review | Save the Anthropic key, then select it on the Anthropic provider in **Settings -> AI & Models**. |
| "Anthropic refused the web search" | Wrong key, no credits, or web search disabled for the Anthropic organization (Claude Console -> Settings -> Capabilities). `Format check` is not authentication. |
| Web search refused for the AI budget | Raise the budget in Settings or wait for the next period; deselect web search to run GitHub only. |
| GitHub throttles (403/429) | Wait for the provider limit to reset. If needed, add server-only `GITHUB_TOKEN` to ignored `.env.local`, then recreate the app with `docker compose up --detach --wait --wait-timeout 300`. Never expose it as `NEXT_PUBLIC_*`. |
| Records appear missing after restart | Check Compose project, original volumes, signed-in account and workspace before creating anything. Do not reset or reseed a different project as a repair. |
| Credential decryption fails | Restore the matching original key/volume with its database. Generating a new key does not recover old ciphertext. |
| Profile has no email, sparse skills or unknown experience | This is expected for public-profile discovery. Review fit and add verified contact details by hand; no enrichment provider is set up. Never invent missing fields. |
| Search stays active after closing the page | Return as the initiating operator to resume the saved run. Inspect errors before starting anything new. |

For full infrastructure details, see [DOCKER.md](../DOCKER.md). The optional
disposable Docker acceptance in that guide checks local runtime persistence with
fixtures and blocks external provider calls; it is separate from this live test.
Do not point that disposable acceptance at the working workspace or its volumes.

## 8. Acceptance receipt to fill in after the test

Keep raw provider receipts, real candidate details and screenshots private. A
shareable report can use this template with aggregate counts and redacted errors:

```text
Date / OS / browser:
Branch / commit:
Compose version / app port:
Core readiness and connected login: PASS / FAIL
Anthropic key saved, linked and persistent (no secret copied): PASS / FAIL / NOT TESTED
Sources selected / limit per source:
LinkedIn via web search: state / found / added / duplicates / excluded / searches billed
GitHub: state / found / added / duplicates / excluded
Real profile mapping and source links checked: PASS / FAIL / NOT TESTED
Unknown fields remain honest: PASS / FAIL / NOT TESTED
Same run recovered after refresh: PASS / FAIL / NOT TESTED
Campaign/candidates/key persist after stack restart: PASS / FAIL / NOT TESTED
Encryption diagnostics after restart: PASS / FAIL / NOT TESTED
Explicit follow-up dedupe test: PASS / FAIL / NOT TESTED
Outbound candidate messages: 0
Remaining blocker (redacted, no private IDs or personal data):
```

A fixture receipt, successful authentication, or zero profiles caused by a
provider refusal is **not** successful live LinkedIn acceptance. The former Apify
account acceptance
([unified-sourcing issue 02](../.scratch/unified-sourcing/issues/02-apify-account-acceptance.md))
was closed when Apify was retired.

## 9. Following product step

The candidate journey now has a dedicated operator procedure:
[Review a sourced candidate](CANDIDATE-REVIEW.md). Use it after the initial live
profile import to check evidence, manual facts/contact, enrichment and drafting.

After the live sourcing check, validate and polish the existing qualification
and enrichment journey: take a discovered candidate through evidence-based fit
review, explicit missing-data/contact discovery and a useful shortlist with a
clear next action. Keep contact permission and human review before outreach.
The project already has enrichment and approval foundations; this next slice
should connect and verify that journey rather than create a parallel pipeline.
Hosted GPT/Claude setup can follow for drafting; it is not required to prove
that real profiles can be discovered and persisted.
