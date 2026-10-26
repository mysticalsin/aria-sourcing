# Documentation map

Start with the root [`README.md`](../README.md), then this map.

## Product and code

| File | Purpose |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Code layout, data authority, sourcing agent, outreach and delivery boundaries, local runtime |
| [`SOURCING.md`](SOURCING.md) | Sourcing providers, the sourcing agent, scoring, enrichment, candidate corpus, compliance |
| [`API_DESIGN.md`](API_DESIGN.md) | Contract policy for the internal `/api` routes |
| [`api/openapi.yaml`](api/openapi.yaml) | Machine-readable contract (currently the candidate-erasure route) |
| [`TESTING.md`](TESTING.md) | Test layers, the manifest-driven `npm test`, database suites |
| [`../src/lib/README.md`](../src/lib/README.md) | Domain modules and import rules |
| [`../tests/README.md`](../tests/README.md) | Test taxonomy and how to register a suite |
| [`../scripts/README.md`](../scripts/README.md) | Local helper scripts |

## Running and operating

| File | Purpose |
|---|---|
| [`../DOCKER.md`](../DOCKER.md) | The local Docker stack: start, reset, ports, services |
| [`../NEEDS_GUIDE.md`](../NEEDS_GUIDE.md) | Feeding a hiring need into ARIA and starting sourcing |
| [`../SUPABASE_SETUP.md`](../SUPABASE_SETUP.md) | Using a hosted Supabase project and Microsoft (Entra) sign-in instead of the local stack |
| [`runbooks/connect-gmail-outlook.md`](runbooks/connect-gmail-outlook.md) | Connecting a Gmail or Outlook sender mailbox |
| [`runbooks/resend-live-send-quickstart.md`](runbooks/resend-live-send-quickstart.md) | Sending real email through Resend |
| [`partnerships/linkedin-rsc-application.md`](partnerships/linkedin-rsc-application.md) | Draft application for an official LinkedIn integration |

## Project process

| Path | Purpose |
|---|---|
| [`../AGENTS.md`](../AGENTS.md) | How AI tools work in this repository (roles, gate, relay baton) |
| [`agents/`](agents/) | Configuration read by the engineering skills (issue tracker, triage labels, domain docs) |
| `../.scratch/` | Local-markdown issue tracker: one folder per feature, `spec.md` plus `issues/` |
| `../_relay/` | Agent shift handoffs. Working state, not product documentation |
