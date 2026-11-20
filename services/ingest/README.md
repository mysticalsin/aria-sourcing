# CV ingest

Toast-style CV intake for Aria. A recruiter (or the candidate portal) drops a file with three pieces of context: **CV source**, optional **job board**, and **destination folder**. This worker extracts text, parses structured fields, runs a duplicate hook, and hands the record to Odoo as a `to_rate` applicant. Failures sit on a sourcing-error queue with a reason code and can be retried.

The module is standalone (`services/ingest/go.mod`). It does not import the Next.js app, and it does not call Odoo, LinkedIn, or any paid OCR API. The Odoo adapter implements `source.Sink`.

## State machine

```
uploaded ─┬─ text_extracted ──────────────────────┐
          └─ ocr_needed ── ocr_done ──────────────┤
                                                  ▼
                              parsed ── deduped ── ready_for_to_rate

any non-terminal state ──► error_queue ──retry──► uploaded
```

`ready_for_to_rate` is terminal. It is Smart's **To Rate** column; the Odoo adapter maps that key onto `hr.recruitment.stage`.

`error_queue` is Toast's sourcing-error queue. A row stores the opaque upload id, a reason code, the attempt count, and the sanitized source slugs. It does not store the file or the parsed text.

| Reason | When |
|---|---|
| `empty_file` | Zero bytes |
| `file_too_large` | Over 8 MiB |
| `unreadable_document` | Not a PDF or image this reader can trust, or a broken stream |
| `extract_failed` | Text extractor returned a transient error |
| `ocr_needed` is a state, not a reason | PDF with no text layer, or a PNG/JPEG |
| `ocr_failed` | Tesseract produced nothing usable |
| `ocr_unavailable` | `tesseract` or `pdftoppm` is not installed |
| `parse_failed` | Text had no name, email, or phone |
| `unsanctioned_source` | CV source or job board is outside the closed list |
| `unknown_folder` | Folder is not holding / communities / country / cv-source / need, or the value is not a slug |
| `unknown_doc_type` | Type is not `cv`, `cover-letter`, or `other` |
| `dedupe_failed` | The duplicate hook returned an error |
| `source_sink_failed` | The Odoo port refused the write |
| `retries_exhausted` | Attempt cap (default 3) spent. `root_reason` keeps the first cause |
| `raw_expired` | Retry after the raw file was purged |

`Ingest` on an id that already exists returns the stored result and does not reprocess. `Retry` is the only way back in from `error_queue`.

## Text, then OCR

1. PDF text layer, pure Go (`extract`). Literal strings, hex strings, `Tj`/`TJ`, FlateDecode. Encrypted PDFs are refused.
2. If the text layer has fewer than 12 letters, or the upload is a PNG/JPEG, the file goes to `ocr_needed`.
3. A text-less PDF is rasterized with Poppler `pdftoppm` (up to 5 pages) and each page is read by Tesseract (`eng+fra+por` by default).
4. The same rules parser runs on whichever text came back.

Tesseract is Apache-2.0, invoked as a local binary. Image bytes go to a `0600` temp file that is removed before return. Stderr from Tesseract and Poppler is discarded.

The parser is deterministic. It understands labeled lines (`Name:`, `Email:`, `Phone:`, `Location:`, `Skills:`, `Languages:`, `Experience:`) and heading blocks (`SKILLS`, `LANGUAGES`, `EXPERIENCE`). Experience lines accept `2022-2024 | Title | Company`, `2022-2024 Title at Company`, and `Title at Company (2022-2024)`. There is no model call.

## Source mapping

Closed CV sources, and the Odoo recruitment label they produce:

| CV source | `utm.medium` when no board is set | Odoo source |
|---|---|---|
| `toast-upload`, `candidate-portal` | `cv-upload` | Candidate-supplied |
| `email` | `email` | Candidate-supplied |
| `folder` | `folder` | Candidate-supplied |
| `referral` | `referral` | Candidate-supplied |
| `recruiter-export` | `recruiter-export` | LinkedIn Recruiter CSV |
| `rsc-ats` | `ats` | RSC/ATS |
| `job-application` | `job-application` | Job application |

A job board, when the recruiter names one, becomes `utm.source` and forces `utm.medium=job-board`. Allowed boards: `indeed`, `welcome-to-the-jungle`, `apec`, `glassdoor`, `monster`, `talentio`, `linkedin-recruiter`. `linkedin-recruiter` means the recruiter uploaded a Recruiter export. This process does not call linkedin.com.

Folders (Toast's folder mapping):

| Folder | `utm.campaign` |
|---|---|
| `holding` | `holding` |
| `communities` | `communities:<slug>` |
| `country` | `country:<slug>` |
| `cv-source` | `cv-source:<slug>` |
| `need` | `need:<slug>` |

Every field is lowercased and must be a slug (`[a-z0-9][a-z0-9._-]{0,63}`). A person's name or an email in any of those fields is dropped before the error queue sees it, and the upload is rejected. `utm.content` is the document type (`cv` when omitted).

The hand-off is `source.Sink.UpsertSource`. The idempotency key is `cv:<upload id>`. `source.Memory` is the in-module fake. `source.Erasable` is optional: profile retention calls it when the adapter implements it.

## Duplicates

After `parsed`, `dedupe.Hook.Observe` runs. The key is the normalized email, else the phone, else the name. A later upload with the same email is still `ready_for_to_rate`, with `DuplicateOf` set so the adapter can link instead of creating. A retry of the same upload id is not its own duplicate. Empty keys are not indexed.

## PII and retention

- Logs are `ingest.LogEvent` only: upload id, states, reason code, byte size, attempt, operation. The type has no text or contact fields, and the worker never formats the CV into a log line.
- Upload ids must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$`. An email-shaped id is refused and not logged.
- Raw bytes and the parsed profile are scheduled on `privacy.Hook`. Defaults are 30 days for the file and 365 days for the profile. Those are engineering defaults until a DPO sets the real periods, not a legal determination.
- `PurgeDue` deletes the bytes and blanks the parsed fields. The state and the UTM mapping stay, so the audit of where a file came from is not the CV body.
- `ARIA_CV_RAW_RETENTION_DAYS` and `ARIA_CV_PROFILE_RETENTION_DAYS` override the CLI defaults. `ARIA_OCR_LANGS` overrides Tesseract languages.

The CLI prints one JSON status object and nothing from the CV. Exit `0` is `ready_for_to_rate`, exit `2` is `error_queue`.

```
ingest -file cv.pdf -cv-source toast-upload -job-board indeed -folder need -folder-value 900001
```

## Tests

Synthetic people only (`*.example.test`). PDFs are generated in the test. The scanned-image case renders a PNG with DejaVu and reads it with Tesseract.

```
cd services/ingest
go test ./...
go test -bench=BenchmarkIngestTextCVs -benchmem -run=^$
```

Field accuracy on the text-layer fixtures is a micro-F1 over name, email, phone, location, skills, languages, and experience. The gate is 0.9.

The text-layer benchmark reports `CVs/s`. OCR is intentionally not on that path; Tesseract is seconds per page and is covered by `TestScannedImageOCRPath`.

## Container

`Dockerfile` builds a static `ingest` binary and runs it on Debian with Tesseract (eng, fra, por) and Poppler. No network calls at runtime.

```
docker build -t aria-ingest services/ingest
docker run --rm -v "$PWD:/in:ro" aria-ingest -file /in/cv.pdf -cv-source toast-upload -folder holding
```
