# Aria services (Go)

In-memory recruiting core for Aria. Odoo 19 Community `hr.recruitment` is the system of record. This module does not dial Odoo, DNA, or SMARTX, and it does not read credential values into logs.

The HTTP process in `cmd/aria-services` always serves the in-memory fakes. `ARIA_MODE=live` is refused.

## Stage keys

Rust, Go, and Odoo use these keys. A later change will put them in one shared spec file and add a drift test.

`to_rate`, `to_assess`, `to_interview`, `shoot`, `qm`, `to_hire`, `hired`, `rejected`, `withdrawn`

| From | Allowed |
|---|---|
| `to_rate` | `to_assess`, `rejected`, `withdrawn` |
| `to_assess` | `to_interview`, `rejected`, `withdrawn` |
| `to_interview` | `shoot`, `rejected`, `withdrawn` |
| `shoot` | `qm`, `rejected`, `withdrawn` |
| `qm` | `to_hire`, `rejected`, `withdrawn` |
| `to_hire` | `hired` (hire gate), `rejected`, `withdrawn` |
| `hired`, `rejected`, `withdrawn` | none |

`hired` is a gated terminal state. The graph edge is not enough. The Go hire gate refuses it unless a contract reference is attached and the DNA fake reports that contract integrated for the same candidate and need. A later pull request adds the Odoo addon that enforces the same rule inside Odoo. Display labels such as "To Rate" are not accepted as input.

## What the packages do

- `internal/odoo` — `Port` for `hr.job`, `hr.applicant`, `hr.recruitment.stage`, `hr.recruitment.source`, `crm.lead`, `res.partner`, `mail.message`, `mail.activity`, and `utm.*`. `Fake` is the in-memory database. `Client` speaks External JSON-2 (`POST /json/2/<model>/<method>`, `Authorization: bearer`, optional `X-Odoo-Database`, named arguments only) and refuses the default HTTP client.
- `UpsertPerson` hides the version difference. Odoo 18 stores `hr.candidate`. Odoo 19 stores a jobless `hr.applicant`. Callers receive a `Person` either way.
- Writes are idempotent. An Aria outbox replays the first result. The outbox is process-local, capped at 1024 entries, and is not the source of reads. A new client reads jobs and applicants through `ir.model.data` and the model. A repeated applicant searches `aria.applicant_<id>` and `(email_normalized, job_id)` before creating. A second applicant id for that email and job is a conflict. A failed external-id bind deletes the new row. Each new outreach touch appends one audit row and writes `mail.message` or `mail.activity`. Replays do not. The same touch key with a different applicant or body is a conflict.
- Approvals live only in `internal/ledger`. The digest is SHA-256 of the canonical preimage in `docs/approval-hash.md`: channel, recipient, subject, body, notice version, and applicant id. Odoo receives an internal note (`mail.mt_note`) that says it does not grant approval. `GrantFromOdoo` always fails. An email touch is stored only when that digest is already granted. Hired, opted-out, and erased applicants refuse further touches and approvals.
- `internal/dna` is Mantu's ERP contract-integration seam. The fake has no URL and no credentials.
- `internal/smart` is an optional future import/export copy. Nothing in the core flow imports it. It rejects display labels, non-synthetic mail, and anything that looks like an ARP or browser automation payload. There is no SMARTX client.
- Cross-keys: `aria.smart_need_<id>` points at `hr.job`, `aria.smart_candidate_<id>` points at `res.partner`, and the applicant record carries both ids for the hire gate.
- Sources are a closed list: `LinkedIn Recruiter CSV`, `RSC/ATS`, `Candidate-supplied`, `Job application`.

## HTTP skeleton

`GET /health`, `GET|POST /campaigns`, `GET|POST /candidates`, `POST /candidates/{id}/transition`, `POST /candidates/{id}/contract`, `POST /candidates/{id}/touches`, `POST /candidates/{id}/opt-out`, `POST /candidates/{id}/erase`, `GET|POST /approvals`, `POST /approvals/from-odoo`. Mutating routes require `Authorization: Bearer` with `ARIA_API_TOKEN`. Health stays open. An empty token fails closed.

`from-odoo` is always forbidden. `to=hired` uses the hire gate. A body field such as `dna_integrated` is rejected. Emails must be `*.example.test`. Recipients must also be on `ARIA_RECIPIENT_ALLOWLIST`.

The process listens on `127.0.0.1:8080`.

## Environment names

The loader reads only these names. Logs print `name=set` or `name=unset`.

`ODOO_URL`, `ODOO_DB`, `ODOO_API_KEY`, `ODOO_VERSION`, `ARIA_MODE`, `ARIA_RECIPIENT_ALLOWLIST`

Unset mode defaults to `test`. Unset version defaults to `19`. `live` is refused. `ODOO_VERSION` may be `18` or `19`.

## Tests

```bash
cd services
go test ./...
go test -bench=. -benchmem -run='^$' ./...
go test -run 'test_odoo_upsert_applicant_is_idempotent|test_go_refuses_hired_without_contract_and_dna' ./...
```

Tests install a transport that fails if anything uses the default HTTP client. JSON-2 checks use an in-memory round tripper. No Odoo, DNA, or SMARTX instance is contacted. Fixtures use invented people and `example.test` mailboxes.
