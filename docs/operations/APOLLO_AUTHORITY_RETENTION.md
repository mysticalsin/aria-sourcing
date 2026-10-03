# Apollo authority retention and erasure

## Runtime policy

- Encrypted email receipts expire 30 days after completion.
- The Fly `cleanup` process runs once at startup and every six hours, so normal
  physical clearance occurs no later than approximately 30 days and six hours.
- Each database call processes at most 500 rows. A workspace receives at most
  20 calls per pass, and workspace pagination is bounded.
- One workspace failure does not stop cleanup for other workspaces.
- Candidate anonymization invokes exact admin erasure before it saves the
  redacted shared document. A retry returns the original erasure event.

## Monitoring

The cleanup process emits one JSON event named `apollo_authority_cleanup` per
pass. Alert when `status` is not `ok`, `failures` is non-empty, or no successful
event has arrived for eight hours. Counters include:

- `expired_receipts_cleared`
- `confirmations_deleted`
- `targets_deleted`
- `expired_targets_scrubbed`
- `quota_rows_deleted`
- `workspacesProcessed`

Fly logs are operational evidence, not the source of truth for candidate data.
Never add service keys, provider identifiers, emails, or upstream error bodies
to cleanup output.

## Release acceptance

Before enabling Apollo paid enrichment in production:

1. Confirm exactly one running `cleanup` process group and its standby with the
   same immutable image digest as `web`.
2. Insert an expired encrypted test receipt and an expired terminal attempted
   target in staging. Keep a separate unresolved attempt as a reconciliation
   control. Wait for or restart cleanup, then prove `email_secret` is empty,
   `receipt_erased_at` is populated, the terminal provider handle is replaced,
   and the unresolved provider handle remains available.
3. Capture the release-SHA-bound, post-deploy cleanup event, including
   `expired_targets_scrubbed`, and the database query result in the private
   release evidence pack.
4. Exercise first erasure, lost-response retry, and a shared-save conflict.
   Confirm the retry completes document redaction with one erasure audit event.
5. Configure a Fly-log alert for missing or non-`ok` cleanup events.

## Retention boundaries

This action removes known structured operational candidate data and Apollo
receipts. Suppression records may be retained to enforce do-not-contact duties.
Provider-side records, application logs, caches, backups, and legal holds require
their own documented retention or DSR procedure. Do not claim immediate global
deletion without separate evidence for those systems.
