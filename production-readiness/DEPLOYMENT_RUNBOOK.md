# ARIA production deployment runbook

**App:** ARIA (repository: MSourcing)

**Production stack:** Fly application plus Fly-hosted Kong, PostgREST, GoTrue, and PostgreSQL services

**Last updated:** 2026-07-11

---

## Release prerequisites

Do not dispatch the Fly workflow until every item below has evidence:

1. Deployment and registry credentials are current, independently scoped, and
   installed only in the protected `Production` environment.
2. The production database volume has a verified recovery point and a successful
   disposable-target restore.
3. The exact database image has passed initialization, persistence, restart, and
   recreated-container tests without initialization credentials.
4. The release artifact contains no populated secret files or private operational
   records.
5. The workflow exists on the default branch, the release branch is protected,
   self-review is prevented, and required exact-SHA checks are enforced.
6. Separate deployment and short-expiry, single-app registry credentials have
   verified provider-side scope. Secret names alone do not prove authority.

The dated source and production posture is in [`STATUS.md`](STATUS.md).

## Canonical Fly release

### 1. Prepare owner-controlled access

Configure the protected GitHub `Production` environment without printing any
value. The workflow uses these separate credential groups:

- `FLY_API_TOKEN` for the deployment step only.
- `FLY_RECOVERY_AUDIT_TOKEN` for the pre-build, read-only volume and snapshot
  inventory check. It must not have deployment, secret, machine, or registry
  mutation authority.
- `FLY_RECOVERY_CLEANUP_TOKEN`, restricted to destroying only the exact
  release-scoped disposable recovery app. It must have no authority on the
  production database or application stack.
- `FLY_REGISTRY_TOKEN` restricted to publishing candidate and release images for
  `aria-mantu-app`, `aria-mantu-db`, `aria-mantu-bootstrap`, and
  `aria-mantu-kong`; it has no deployment authority.
- Distinct 43–128 character base64url database targets:
  `FLY_SUPABASE_ADMIN_TARGET_PASSWORD`, `FLY_PG_PASSWORD`,
  `FLY_AUTH_DB_PASSWORD`, and `FLY_REST_DB_PASSWORD`, plus the current owner
  credential `FLY_SUPABASE_ADMIN_CURRENT_PASSWORD` for one-way rotation.
- Database, JWT, Supabase, encryption, cron, and enabled provider secrets named
  in `.github/workflows/deploy-aria-mantu.yml`.
- `ARIA_VOLUME_RECOVERY_RECEIPT_JSON`, generated from
  [`volume-recovery-receipt.example.json`](volume-recovery-receipt.example.json)
  only after the exact snapshot has been restored and verified on a disposable
  non-production volume.
- `ARIA_VOLUME_RESTORE_CREATE_REQUEST_JSON` and
  `ARIA_VOLUME_RESTORE_CREATE_RESPONSE_JSON`, the canonical private request and
  captured Fly response from that exact restore-volume creation. They are
  materialized with mode `0600` and never uploaded.
- `ARIA_FIRST_DEPLOY_APPROVAL` is normally absent. It is allowed only for a
  genuine first deployment with missing prior image history, using exactly
  `aria-first-deploy-v1:<release-sha>:<recovery-receipt-sha256>`. Remove it
  immediately after that release and never use it for an inventory outage.
- `ARIA_ADMIN_BOOTSTRAP_APPROVAL` is a protected environment variable, normally
  absent. If the administrator inventory proves that no real allowed-domain
  administrator exists, set it to exactly
  `aria-admin-bootstrap-v1:<release-sha>:<recovery-receipt-sha256>` and install
  `ARIA_FIRST_ADMIN_EMAIL` plus `ARIA_FIRST_ADMIN_PASSWORD`. This approval is
  independent of image history, which allows recovery of an already-deployed
  but uninitialized environment. The email must use the allowed domain and the
  unique password must be at least 24 characters. Remove the variable and both
  secrets immediately after the run. A later release with an existing real
  administrator rejects stale bootstrap approval or credentials.

Use [`.fly-secrets.example`](.fly-secrets.example) as the name-only template.
Generate every database target and `FLY_JWT_SECRET` independently (for example,
48 random bytes encoded as base64url without padding). Never reuse a database
password as a JWT, provider, encryption, or cron secret. Rotating the JWT secret
  also requires freshly signed matching anon and service-role JWTs.

Set the protected environment variable `ARIA_ALLOWED_EMAIL_DOMAIN` to the exact
canonical lowercase tenant email domain. The production image build rejects
blank, whitespace, uppercase, malformed, single-label, and IP-like values; do
not disable the tenant-domain boundary for convenience.

Keep `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false` until the Entra application,
callback URI, and provider credentials are separately approved and tested.
Email and password is the primary production login path in that state; the UI
must not present a Microsoft button that cannot work.

Set `DATABRICKS_ALLOWED_ORIGINS` in deployment-controlled application
configuration before enabling Databricks. Follow
[`DATABRICKS_AUTHORITY_MIGRATION.md`](DATABRICKS_AUTHORITY_MIGRATION.md) for the
clone rehearsal and admin rebinding.

### 2. Prove the exact source revision

From a clean checkout of the candidate SHA:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run test:security
npm audit --audit-level=high
npm ls --all
NPM_CONFIG_OFFLINE=true npm run build:isolated
```

Run `npm run test:db-privileges` against a disposable PostgreSQL target with a
working Docker backend. It must never receive production credentials. Require
successful CI, database-security, secret-scan, dependency-audit, supply-chain,
aggregate-gate, and CodeQL results for the same 40-character commit SHA. The
protected release token has read-only code-scanning access; the workflow also
queries the protected release ref and fails on any open high or critical alert.

### 3. Preserve data before recovery or migration

Create a provider snapshot, volume clone, or equivalent recovery point. Restore
it to a disposable target and verify the migration ledger, named tables, RLS,
final routine privileges, future-object default privileges, and bounded row
fingerprints. Do not bypass the bootstrap legacy-schema guard or invent ledger
rows. Record recovery owner, rollback target, stop conditions, restore duration,
RPO, and RTO.

For the Fly path, quiesce writes, create the on-demand snapshot, restore that
exact snapshot to a different volume and app, and compute deterministic schema
and bounded-row SHA-256 fingerprints there. Populate the strict receipt template
with the live source volume, snapshot, disposable target, fingerprints, exact
release SHA, and independent owner approval. The snapshot must be under 24 hours
old; quiescence must precede it by no more than 15 minutes; the restore must
finish before approval; and the approval must expire within four hours. Install
the complete JSON as the protected `ARIA_VOLUME_RECOVERY_RECEIPT_JSON` secret.
The disposable app name is exactly
`aria-mantu-db-recovery-<first-12-release-sha-characters>`, has no public IP,
uses one encrypted volume at least as large as the source, and has a destruction
deadline no more than 24 hours after restore completion.

Capture the restore-create request and provider response without logging either
JSON document. The same shell variables must drive both the request contract and
the Fly call:

```bash
umask 077
RESTORE_APP="aria-mantu-db-recovery-${RELEASE_SHA:0:12}"
RESTORE_REQUEST="$(mktemp)"
RESTORE_RESPONSE="$(mktemp)"

node -e '
  const [snapshotId, app, size] = process.argv.slice(1);
  const request = {
    schemaVersion: 1,
    operation: "create-volume-from-snapshot",
    snapshotId,
    app,
    volumeName: "aria_db_data_restore",
    region: "cdg",
    sizeGb: Number(size),
  };
  process.stdout.write(`${JSON.stringify(request)}\n`);
' "$SNAPSHOT_ID" "$RESTORE_APP" "$RESTORE_SIZE_GB" > "$RESTORE_REQUEST"

flyctl volumes create aria_db_data_restore \
  --app "$RESTORE_APP" \
  --region cdg \
  --size "$RESTORE_SIZE_GB" \
  --snapshot-id "$SNAPSHOT_ID" \
  --json > "$RESTORE_RESPONSE"
chmod 0600 "$RESTORE_REQUEST" "$RESTORE_RESPONSE"

node scripts/recovery-receipt-digest.mjs "$RESTORE_REQUEST"
node scripts/recovery-receipt-digest.mjs "$RESTORE_RESPONSE"
```

Put those digests in `providerRequestSha256` and
`providerResponseSha256`, then install the canonical file contents as the two
protected JSON secrets. Delete the operator copies after confirming the secrets.
The workflow recomputes both hashes, checks every request field, binds the
response volume to live provider inventory, and uploads hashes only.

Compute the visible dispatch digest from the same receipt file with:

```bash
node scripts/recovery-receipt-digest.mjs /path/to/volume-recovery-receipt.json
```

Enter that digest as `recovery_receipt_sha256`. The protected workflow
canonicalizes the secret JSON, requires its SHA-256 to equal the visible input,
and checks GitHub's workflow-run approval history: the named receipt approver
must have approved `Production`, must not be the dispatch actor, and must use the
exact review comment `recovery-receipt-sha256:<digest>`. This binds the human
approval to the reviewed receipt rather than merely to the workflow run.
Verify the existing source volume retains snapshots for at least 14 days; the
`fly.db.toml` setting governs newly created volumes and does not substitute for
checking or updating the already-mounted production volume.

```bash
flyctl volumes update <verified-production-volume-id> \
  --app aria-mantu-db \
  --snapshot-retention 14 \
  --scheduled-snapshots
```

Re-list the volume as JSON and confirm `snapshot_retention >= 14`,
`auto_backup_enabled: true`, and `encrypted: true`; the workflow enforces all
three again and does not infer them from the configuration file.

The source app and disposable restore app must each expose exactly one Machine.
The source Machine ID must equal the production-volume attachment. The restore
Machine must be started and must equal the restore-volume attachment. Both
inventories are refreshed before mutation, and bootstrap preflights use the
exact `<machine-id>.vm.<app>.internal` address rather than app-wide DNS.

The workflow uses a separate read-only token to compare the receipt with live
Fly volume, snapshot, encryption, retention, backup, attachment, and public-IP
state before it builds. It refreshes that provider state again immediately
before production mutation, and the deploy script revalidates the private files
before loading runtime secrets. Missing, stale, detached, ambiguous, undersized,
unencrypted, public, mismatched, still-running, or un-restored recovery points
fail closed. Raw receipts, provider inventories, infrastructure IDs, and reviewer
identity are never uploaded; the evidence bundle contains only their SHA-256
digests and validation result. The disposable app, machine, and restored volume
are destroyed with the separately scoped cleanup credential on every validated
workflow exit. A private cleanup target is written immediately after provider
validation, before reviewer-history lookup, so a reviewer API error cannot
strand the clone. Machine, volume, and app deletion are retried independently;
cleanup succeeds only after a fresh app inventory proves absence. The cleanup
token therefore needs read access to its exact app inventory as well as destroy
authority on that app, and no authority on production.

#### Database recovery preflight and pre-ledger adoption

The bootstrap image exposes a read-only phase that must run against the
disposable restore target and again against production before owner credential
rotation or any ledger write:

```text
ARIA_BOOTSTRAP_PHASE=recovery-preflight
ARIA_RECOVERY_MIGRATION_STATE=verified-empty | verified-pre-ledger | complete-ledger
SUPABASE_ADMIN_CURRENT_PASSWORD=<current direct owner credential>
ARIA_LEGACY_APPROVED_SCHEMA_SHA256=<receipt restoreDrill.schemaFingerprintSha256>
ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256=<receipt restoreDrill.rowFingerprintSha256>
ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256=<receipt restoreDrill.migrationManifestSha256>
```

No target password, JWT, or runtime credential is accepted or required by this
phase. It opens a direct `supabase_admin` `SERIALIZABLE READ ONLY` transaction,
exports and holds one PostgreSQL snapshot, and imports that snapshot into the
`pg_dump` and `REPEATABLE READ READ ONLY` verification sessions. The schema,
table contents, and ledger are therefore measured from one database point in
time. It checks the exact table and function sets plus RLS, then recomputes all
three approved fingerprints. `complete-ledger` also requires
`public.aria_schema_migrations` to match every source filename and SHA-256.
`verified-pre-ledger` requires the ledger to be absent or empty.
`verified-empty` requires PostgreSQL major version 17, the pinned fresh-cluster
public-schema fingerprint, no ARIA ledger, no public tables, and no public
functions. It emits recovery evidence only, then permits the fresh `owner`
followed by `migrations` path. It never permits legacy baselining.

Every passing state prints `ARIA_RECOVERY_PREFLIGHT_SHA256=<digest>`; store it
as `restoreDrill.recoveryPreflightSha256`. For `verified-empty` and
`complete-ledger`, set
`restoreDrill.legacyBaselineApprovalSha256` to JSON `null` so the receipt cannot
authorize ledger adoption.

The fingerprints have one canonical representation:

- Schema: `pg_dump --schema-only --no-owner --no-privileges --schema=public
  --exclude-table=public.aria_schema_migrations`, with random `\\restrict` /
  `\\unrestrict` lines and dump-version headers removed, then SHA-256.
- Rows: for `verified-pre-ledger` and `complete-ledger`, the 24 reviewed public
  application tables in lexical order. Each row is converted to canonical JSON
  text inside PostgreSQL and hashed; the sorted row hashes are hashed again for
  the table. The manifest contains one
  `public.<table>=<count>:<ordered-row-content-sha256>` line per table, with a
  final newline, and the complete manifest is SHA-256 hashed. For
  `verified-empty`, the row manifest is the empty byte sequence. Raw row values
  never leave PostgreSQL.
- Migrations: every `supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql` file in
  C-locale filename order, one `<filename>=<file-sha256>` line with a final
  newline, then SHA-256.

On `verified-pre-ledger`, a passing preflight prints
`ARIA_LEGACY_BASELINE_APPROVAL_SHA256=<digest>`. Record that value as both
`restoreDrill.recoveryPreflightSha256` and
`restoreDrill.legacyBaselineApprovalSha256` before the independent owner reviews
and approves the receipt digest. The deploy compares the restored and production
preflight outputs with those approved fields before the only permitted ledger
adoption call:

```text
ARIA_BOOTSTRAP_PHASE=legacy-baseline
SUPABASE_ADMIN_CURRENT_PASSWORD=<same current direct owner credential>
ARIA_LEGACY_APPROVED_SCHEMA_SHA256=<same approved schema fingerprint>
ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256=<same approved row fingerprint>
ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256=<same approved migration manifest>
ARIA_LEGACY_BASELINE_APPROVAL_SHA256=<exact preflight output approved by owner>
```

The baseline phase repeats the read-only proof, then opens a `READ COMMITTED`
write transaction so a snapshot is not fixed before lock waits finish. It
acquires the migration advisory lock, locks all 24 application tables and any
pre-existing empty ledger in `SHARE` mode, and rechecks the schema invariants,
row counts, and exact content hashes before recording the filename-plus-SHA
ledger. A concurrent data or ledger change fails the baseline. It never rotates
credentials. Only after it succeeds may the release call `owner`, followed by
`migrations`. `complete-ledger` must never call `legacy-baseline`; it proceeds
from a passing recovery preflight to the normal owner and migration phases.
`verified-empty` also must never call `legacy-baseline`; its only permitted
continuation is `owner` then `migrations`.

### 4. Dispatch the protected workflow

Use `Deploy Aria Mantu (Fly)` only after its definition is present on the GitHub
default branch and the `Production` approval has been granted by a reviewer who
is neither the original workflow actor nor the actor who triggered a rerun. The
recovery evidence records the initial actor, triggering actor, and approver.
Select the protected `deploy/fly-github-actions` ref and enter its exact tip SHA;
the workflow rejects any ref/SHA mismatch. Do not invoke `deploy-fly.sh` directly
from an operator shell.

Before mutation, the deploy captures exact prior image digests for DB, Auth,
REST, Kong, and app. Missing history fails closed. The only exception is a true
first deployment with the exact protected approval
`aria-first-deploy-v1:<release-sha>:<recovery-receipt-sha256>`. A partial or
transient inventory failure is not a first deployment. Remove that approval
from the protected environment after the run, whether the run passes or fails.

Before its first Fly mutation, the deploy validates the data-encryption key as
canonical base64 for exactly 32 bytes, validates `CRON_SECRET` as 64 lowercase
hexadecimal characters, and inventories every managed app secret. Every row
must use a known name and report Fly status `Deployed`; `Staged`, `Partial`,
`Unknown`, missing/invalid status, duplicates, or an unmanaged name stop the run
before mutation. Omitted optional app credentials are staged for removal only
immediately before the app image is activated. After each activation, the
workflow requires the exact intended secret-name set with every row `Deployed`.

An interrupted or failed `secrets import --stage` is deliberately not
"cleaned up" with `secrets unset --stage`: that command would stage deletions,
not restore the unreadable previous values. The run reports the state as
ambiguous and stops. Do not retry until an owner has inspected `fly secrets
list --json` for the affected app and reconciled every staged change.

`FLY_DATA_ENCRYPTION_PREVIOUS_KEYS` is also fail-closed on omission. If that
secret is already deployed, an empty workflow value cannot remove it unless an
owner first proves that no `api_keys.secret`, `email_connections.access_token`,
or `email_connections.refresh_token` envelope still requires a retiring key,
then sets
`ARIA_DATA_KEY_RING_RETIREMENT_APPROVAL=aria-data-key-ring-retirement-v1:<release-sha>:<recovery-receipt-sha256>`.
The approval is exact-release and recovery-evidence bound. Remove it after the
single reviewed run. A stale approval, an empty JSON ring, or an unapproved
omission stops before production mutation.

The workflow must perform this one-way artifact chain:

```text
exact SHA -> build app/DB/bootstrap/Kong for linux/amd64
          -> push isolated candidate tags -> resolve + pull registry digests
Auth/REST config pins -> pull exact upstream linux/amd64 digests
all six images -> schema-validated CycloneDX + HIGH/CRITICAL gates
               -> filesystem + image-config/history secret gates
          -> signed provenance/SBOM attestations -> immutable SHA promotion
          -> fly deploy/run --image tag@digest -> running digest equality
```

Fly must not rebuild any custom image during this path. Auth and REST use the
digest-pinned stock images declared in their Fly configurations. They are
inventoried as upstream runtime provenance and are not given false local-build
attestations. Their running digests must still equal the scanned config pins.

After the immutable images are deployed, the workflow performs application
acceptance in this fixed order:

1. `deploy-fly.sh` writes `aria-deployment-receipt.json` with status
   `pending-application-acceptance`. It cannot print `RELEASE_ACCEPTED`.
2. The tenant-administrator gate queries real allowed-domain administrators.
   If one exists, stale bootstrap approval and credentials are forbidden. If
   none exists, the exact protected administrator-bootstrap approval and
   credentials are required, and `scripts/provision-first-admin.sh` creates,
   signs in, and verifies the administrator independently of image history. The
   helper proves the canonical GoTrue identity, active email provider, prior
   sign-in, and exact profile/workspace/domain/role binding. If the allowed
   domain workspace already exists without an active administrator, it stops
   before creating a user and requires the reviewed owner-recovery procedure.
3. `scripts/acceptance-campaign-dry-run.sh` creates a unique, marked,
   null-domain workspace and plus-address synthetic user. It proves the exact
   authenticated workspace binding through the application, persists and
   reloads one synthetic campaign and one `Needs Approval` draft, exercises
   email with `confirmLive=false`, confirms LinkedIn remains manual-only, and
   requires zero `outreach_ledger` and `messages_outbound` rows.
4. The acceptance harness deletes only resources whose exact IDs and marker
   match, proves their absence, and only then writes
   `aria-application-acceptance.json`. A setup, request, assertion, or cleanup
   failure produces no passing receipt.
5. The workflow destroys the exact disposable recovery app, machine, and
   volume, then proves the app is absent from fresh provider inventory.
6. The workflow validates every application and recovery proof, then writes
   `aria-release-candidate-receipt.json` with status
   `pending-evidence-archive`. The evidence inventory binds its SHA-256, the
   completeness gate verifies all required files, and the candidate evidence
   bundle is uploaded as
   `aria-release-candidate-evidence-<sha>-attempt-<attempt>`.
7. Only after that upload succeeds does the workflow write
   `aria-release-receipt.json` with status `accepted` and the evidence-inventory
   SHA-256. The accepted receipt also binds the immutable GitHub artifact ID and
   artifact SHA-256 returned by that candidate-evidence upload. A separate
   upload archives this accepted receipt.
8. The terminal `if: success()` step revalidates the archived accepted receipt.
   It is the only step allowed to print `RELEASE_ACCEPTED`.

The isolated campaign proof never invokes an eligible delivery provider, never
uses real candidate data, and never modifies a real tenant. It proves release
mechanics, not legal approval for real recruiting activity.

### 5. Retain release evidence

Every outcome uploads an evidence inventory with file existence, size, and
SHA-256. The always-run artifact is explicitly named as candidate evidence,
never as an accepted release receipt. Candidate and accepted artifact names
include the GitHub run attempt so workflow reruns cannot collide with an earlier
partial bundle. A successful release additionally requires non-empty copies of:

- `aria-release-receipt.json`
- `aria-release-candidate-receipt.json` showing status
  `pending-evidence-archive` and binding all application/recovery proofs before
  evidence upload
- `aria-deployment-receipt.json` showing that the exact SHA was deployed but
  was still pending application acceptance
- `aria-tenant-admin-verification.json` proving first-admin or existing-admin
  access without exporting a credential or administrator email
- `aria-application-acceptance.json` proving authenticated persistence,
  no-send behavior, and exact cleanup
- `aria-volume-recovery-cleanup.json` proving that the disposable recovery
  target is absent
- `aria-predeploy-receipt.json` with the rollback digests captured before mutation
- `aria-release-manifest.json` binding candidate/promoted images, Dockerfile
  hashes, scanner reports, and attestation IDs
- per-component CycloneDX, vulnerability, filesystem and image-config/history
  secret, and checksum files for app, DB, bootstrap, Kong, Auth, and REST
- provenance-attestation and SBOM-attestation files for the four locally built
  images only: app, DB, bootstrap, and Kong
- `upstream-images.tsv` plus release-manifest entries binding Auth and REST to
  their upstream repositories and exact config-pinned digests

A failed scan, registry publication, deployment, evidence check, or artifact
upload must remain failed and can never produce the terminal acceptance
announcement. The always-run candidate evidence upload may retain partial
failure evidence, but only a successful separate accepted-receipt upload can
precede `RELEASE_ACCEPTED`.

### 6. Accept or roll back

Acceptance requires the same immutable release to prove database, Auth, REST,
Kong, application liveness, `/api/ready`, complete migration-ledger identity,
running application digest, two restart cycles, backup restore, rollback, a
real tenant administrator, and isolated authenticated campaign persistence with
zero outbound delivery rows. The release receipt is evidence only after all
checks and cleanup pass.

If any check fails, stop external traffic and use the last accepted receipt to
select the prior application digest. Database rollback is restore/forward-fix
work, not an automatic reverse migration. Never delete or recreate the sole
production volume without approved recovery proof.

#### Fly database rollback after the root-to-child layout cutover

Do not invoke an old image blindly. First inspect a preserved clone of the
volume and classify the on-volume journal state:

1. No `.aria-layout-migration-v1` or pending journal, canonical PostgreSQL files
   still at the volume root, and no child cluster: the move did not start. Fix
   the release issue and rerun the approved candidate.
2. `.aria-layout-migration-v1` or `.aria-layout-migration-v1.pending` exists:
   the move is journaled or split. Redeploy the same approved database image with
   the same receipt-bound `ARIA_DB_LAYOUT_MIGRATION_APPROVAL`; its entrypoint
   resumes without overwriting child entries. Do not start the previous image.
3. `/var/lib/postgresql/data/.aria-init-complete` contains `aria-db-init-v1`, all
   canonical cluster entries are under the child, and no legacy root entries
   remain: the layout cutover completed. The previous database image can run
   against the new parent mount through the current configuration:

   ```bash
   fly deploy --config fly.db.toml --image <previous-database-image-digest> --wait-timeout 10m
   ```

4. Both root and child contain the same canonical entry, a journal has the wrong
   approval, or the completion marker is absent after the root emptied: stop.
   Do not move files manually. Restore the approved snapshot to a new private
   volume and follow the reviewed volume-swap procedure.

After a resume or image rollback, prove the exact source Machine and attachment,
run the receipt-bound production preflight, and check PostgreSQL, Auth, REST,
Kong, and `/api/ready`. An ambiguous provider-side deployment remains a manual
recovery event; never guess and start a second database Machine.

# Legacy Vercel demo appendix

The remainder of this document describes the isolated Vercel demo path. It is
not the ARIA production release procedure and must not be used to recover or
deploy the Fly data plane.

## Prerequisites

| Requirement | Where to check |
|---|---|
| Vercel CLI installed (`npm i -g vercel`) | `vercel --version` |
| Supabase CLI installed | `supabase --version` |
| Node 22.x | `node --version` and `package.json` `engines.node` |
| GitHub Actions CI green on `main` | GitHub → Actions tab |
| All required env vars set in Vercel project | Vercel → Project → Settings → Environment Variables |

---

## 1. Pre-deployment gate (run every time)

All checks must pass before a production deploy is triggered. Block the deploy if any fails.

```bash
# From the repo root:
npm run typecheck       # tsc --noEmit; must exit 0
npm run lint            # next lint; must be "No ESLint warnings or errors."
npm run test            # 28 pretest + 118 test commands; all must pass
npm run test:security   # security-specific subset (faster); must be 0 failures
npm run build           # must complete without error in CI or an unsynced checkout
npm run build:isolated  # required for this OneDrive-synced checkout
```

If the applicable build command fails, do NOT proceed. Fix the build first.

`build:isolated` creates an empty temporary project, copies the build inputs,
installs from the lockfile, clears any inherited `NEXT_DIST_DIR`, and runs the
normal production build. Vercel continues to use `npm run build`; do not set
an absolute `NEXT_DIST_DIR`, because Turbopack rejects output outside the
project root.

---

## 2. Database migrations (Supabase)

Migrations must be applied **before** the new code is live. The migration files live in `supabase/migrations/`. Apply every file in strict numeric order.

### 2a. Check current schema state

```bash
supabase db diff --schema public --linked
```

If the diff is empty, the DB is already at HEAD — skip to step 3.

### 2b. Apply pending migrations

```bash
# Recommended: use the Supabase CLI (linked to your project)
supabase db push

# Alternative: run the SQL files manually in Supabase SQL Editor.
# Order matters. Apply every file below:
# 0001_init.sql → workspaces, profiles, workspace_state, base RLS, ensure_workspace()
# 0002_fleet.sql → agent_seats, suppression_list, outreach_ledger, claim_and_record() RPC
# 0003_api_keys.sql → api_keys, column-level grants for server-side secrets
# 0004_email_connections.sql → email_connections for Gmail/Microsoft OAuth tokens
# 0005_rls_tenant_isolation.sql → hardened tenant grants, anon revoke, role-gated writes
# 0006_outreach_approvals.sql → durable human approval records
# 0007_agent_runtime.sql → agent runtime and durable message ledgers
# 0008_human_outbound_approvals.sql → human approval provenance
# 0009_whatsapp_delivery_policy.sql → consent/template/window dispatch policy
# 0010_whatsapp_delivery_reconciliation.sql → Meta acceptance and receipt audit
# 0011_outreach_approval_lifecycle.sql → approval revoke and atomic email claims
# 0012_email_unsubscribe.sql → opaque one-click unsubscribe token hashes
# 0013_outreach_approval_race_safety.sql → serialized approval/revoke/dispatch lifecycle
# 0014_whatsapp_review_and_inbound_recovery.sql → human review and recoverable inbound work
# 0015_whatsapp_webhook_late_event_safety.sql → late receipt and draft-collision safety
# 0016 intentionally unreleased — gap is deliberate
# 0017_dispatch_concurrency.sql → dispatcher claim concurrency safety
# 0018_first_admin.sql → first-admin bootstrap path
# 0019_agent_authority_and_integrations.sql → normalized Databricks authority and final routine ACLs
# 0020_dust_authority.sql → normalized Dust authority, append-only config audit, and legacy-state removal
# 0021_claim_serialization.sql → per-seat FOR UPDATE lock serializes the daily-cap count in claim_and_record
# 0022_email_send_reconciliation.sql → immutable send_attempt_id + non-retryable 'ambiguous' state for unknown post-acceptance outcomes
# 0023_conversation_identity.sql → canonical agent_conversations + provider-thread binding; ambiguous inbound fails closed to triage
# 0024_cross_channel_claim_serialization.sql → shared per-seat cap lock across email and WhatsApp claims
# 0025_agent_memory_authority.sql → exact owner/spec memory authority, receipts, and legacy-memory quarantine
# 0026_apollo_enrichment_authority.sql → exact paid-enrichment authority, quota, reconciliation, retention, and erasure
```

**IMPORTANT:** RLS must be enabled on every table listed above. Verify after each migration:

```sql
-- In Supabase SQL Editor, confirm RLS is ON:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workspaces','profiles','workspace_state','agent_seats',
                    'suppression_list','outreach_ledger','outreach_approvals',
                    'api_keys','email_connections',
                    'agent_specs','agent_runs','agent_events','messages_outbound',
                    'messages_inbound','whatsapp_contacts','whatsapp_senders',
                    'whatsapp_templates','whatsapp_conversation_windows',
                    'outbound_content_cache','whatsapp_delivery_events',
                    'databricks_connections','databricks_connection_events',
                    'dust_connections','dust_connection_events');
-- Every row must show rowsecurity = true
```

### 2c. Verify RPC exists

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'claim_and_record', 'claim_email_outbound', 'claim_whatsapp_outbound',
    'record_outreach_approval', 'revoke_outreach_approval',
    'review_whatsapp_outbound', 'claim_whatsapp_inbound_processing',
    'complete_whatsapp_inbound_processing',
    'record_whatsapp_provider_acceptance', 'record_whatsapp_delivery_event',
    'stamp_databricks_connection_authority',
    'audit_databricks_connection_authority',
    'strip_legacy_databricks_authority',
    'stamp_dust_connection_authority', 'audit_dust_connection_authority',
    'strip_legacy_dust_authority'
  );
-- Must return every named routine.
```

---

## 3. Environment variables

All variables below must be set in Vercel **before** deploying. Production values only — never commit secrets to git.

Minimum live production set: the Supabase trio
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`), `DATA_ENCRYPTION_KEY`, `CRON_SECRET`,
`OUTREACH_UNSUBSCRIBE_BASE_URL`, Google OAuth variables if Gmail seats are used,
Microsoft OAuth variables if Outlook seats are used, and at least one verified
delivery path before any live email is enabled.

| Variable | Scope | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Yes | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Yes | Supabase → Project Settings → API → anon public |
| `SUPABASE_URL` | Server | Optional | Server-side override for the Supabase project URL; defaults to `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes | Never expose to browser. Supabase → API → service_role |
| `DATA_ENCRYPTION_KEY` | Server | Yes | Base64 32-byte key for provider/OAuth secrets at rest |
| `DATA_ENCRYPTION_PREVIOUS_KEYS` | Server | During key rotation only | JSON array of up to eight distinct prior canonical base64 32-byte keys. New ciphertext carries a SHA-256 key ID; keep prior keys until all older `enc:v1`/`enc:v2` rows have been re-encrypted and verified. |
| `CRON_SECRET` | Server | Yes for dispatcher | Strong random bearer secret for `/api/cron/dispatch-outbound` |
| `CAREERS_WORKSPACE_ID` | Server | Yes to enable `/careers` | UUID of the single workspace allowed to publish public roles; leave unset to fail closed |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | Public | Recommended | Locks sign-in to one domain (e.g. `mantu.com`) |
| `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` | Public | No for live prod | Synthetic demo-login escape hatch; keep false/unset in real production |
| `DEMO_SESSION_SECRET` | Server | Required if demo login is enabled | HMAC secret for signed demo sessions |
| `DEMO_ADMIN_PASSWORD` | Server | Required if demo login is enabled | Demo admin password; do not use for real tenants |
| `HERMES_API_URL` | Server | For AI drafts | Internal only; must not be a public internet URL |
| `HERMES_API_KEY` | Server | For AI drafts | Strong random token (≥32 chars) |
| `HERMES_PROXY_SECRET` | Server | If Hermes proxy route is used | Shared secret for proxy calls |
| `HERMES_RUNTIME_WORKSPACE_ID` | Server | Required with Hermes | UUID of the single workspace bound to this dedicated runtime; no shared multi-workspace process |
| `GOOGLE_CLIENT_ID` | Server | If Gmail seats used | |
| `GOOGLE_CLIENT_SECRET` | Server | If Gmail seats used | |
| `GOOGLE_REDIRECT_URI` | Server | If Gmail seats used | `https://<app>/auth/google/callback` |
| `MICROSOFT_CLIENT_ID` | Server | If Graph seats used | |
| `MICROSOFT_CLIENT_SECRET` | Server | If Graph seats used | |
| `MICROSOFT_REDIRECT_URI` | Server | If Graph seats used | `https://<app>/auth/microsoft/callback` |
| `RESEND_API_KEY` | Server | If Resend email used | |
| `SENDGRID_API_KEY` | Server | If SendGrid email used | |
| `OUTREACH_UNSUBSCRIBE_BASE_URL` | Server | Yes for live email | Canonical HTTPS app origin, no query/fragment |
| `GITHUB_TOKEN` | Server | If GitHub sourcing is used | Read-only token for source search |
| `TAVILY_API_KEY` | Server | If Tavily web sourcing is used | Server-side fallback; stored workspace key can take precedence |
| `ARIA_ENABLE_REMOTE_MCP_EXECUTION` | Server | No | Keep false/unset. Production code denies third-party MCP execution even if set true; development/test requires explicit true |
| `KIMI_API_KEY` | Server | If Kimi provider is used | Kimi/Moonshot provider key |
| `KIMI_BASE_URL` | Server | Optional | Defaults to `https://api.moonshot.ai/v1` |
| `ELEVENLABS_API_KEY` | Server | If voice TTS is used | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | Server | Optional with voice TTS | Defaults in code when unset |
| `WHATSAPP_TOKEN` | Server | If WhatsApp used | Meta Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | Server | If WhatsApp used | Meta registered sender ID |
| `WHATSAPP_API_VERSION` | Server | Optional with WhatsApp | Defaults to `v21.0` |
| `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` | Server | If WhatsApp webhooks used | Verify Meta subscription and signatures |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Server | Reserved | SMS remains disabled until equivalent controls exist |
| `FLOWISE_URL` / `FLOWISE_API_KEY` | Server | If Flowise inference used | Private runtime only; browser authoring remains disabled |
| `OBSCURA_URL` / `OBSCURA_BIN_PATH` | Server | Optional research sidecar | Read-only browser research sidecar endpoint or binary path |

Third-party MCP discovery and execution are both denied in production before a
workspace credential is resolved or a network transport is opened. The admin
test endpoint is development/test-only, restricted to HTTPS port 443, and still
requires `ARIA_ENABLE_REMOTE_MCP_EXECUTION=true`. The Hermes route, model loop,
route policy, and MCP client each fail closed independently.
Each server contributes at most 16 provider-safe tools, each model request sees
at most 32 tools, and a loop may execute at most 12 calls within one 30-second
default deadline. External descriptions and results are size-capped and labeled
as untrusted data. The label is model context, not a security boundary.

Verify all variables are visible in Vercel before continuing:

```bash
vercel env ls --environment production
```

---

## 4. Deploy to Vercel

### Option A — Git push (recommended for main deployments)

```bash
git push origin main
```

Vercel's GitHub integration triggers a build automatically. Monitor in the Vercel dashboard.

### Option B — Vercel CLI (manual or hotfix)

```bash
vercel --prod
```

The CLI will print the deployment URL on completion.

### Build output to expect

```
Route (app)                              Size
┌ ○ /                                    ...
├ ○ /login                               ...
├ ○ /floor                               ...
...
✓ Build completed
```

Any `Error` or `Type error` output is a hard stop — rollback or fix before proceeding.

---

## 5. Post-deployment smoke check

Run these manually within 10 minutes of a production deploy. If any step fails, trigger the rollback runbook.

### 5a. Auth flow

1. Open `https://<app>/login` in an incognito window.
2. Click **Continue with Microsoft**.
3. Complete Entra SSO.
4. Confirm redirect to `/` or `/floor` (not an error page).
5. Check browser console — 0 errors expected.

### 5b. Critical routes

| Route | Expected | Pass? |
|---|---|---|
| `/` | Redirects to `/login` (if not authed) or dashboard | |
| `/floor` | Operations floor renders (2D grid + 3D toggle) | |
| `/fleet` | Fleet page loads, agent list visible | |
| `/settings` | Settings tabs render (requires admin role) | |
| `/chat` | Chat interface loads | |
| `/outreach` | Outreach panel loads | |

### 5c. Server-side key vault

```bash
# POST a test key (admin user's session cookie required):
curl -s -X POST https://<app>/api/keys \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"name":"smoke-test","provider":"test","value":"sk-test-1234567890"}'
# Expect: {"ok":true, "last4":"7890", ...}
# The 'secret' field must NOT appear in the response.
```

### 5d. Outreach dry-run guard

Navigate to `/outreach`, create a draft outreach. Confirm that:
- The human approval gate is visible before any send.
- No outreach is dispatched without explicit confirmation.
- If any seat is in dry-run mode, "Dry run" is displayed — no real email is sent.

### 5e. CSP headers

```bash
curl -sI https://<app>/ | grep -i content-security-policy
# Must return a non-empty CSP header with at least: default-src, script-src, connect-src
```

### 5f. Email unsubscribe proof (before enabling any live email seat)

1. Send one approved email to a controlled inbox.
2. Inspect raw MIME: it must contain `List-Unsubscribe`,
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a visible footer link.
3. Open the link: GET must show the confirmation page without changing suppression.
4. Submit the form/one-click POST and verify one permanent `suppression_list` email row.
5. Attempt another approved send to that address: it must return `skipped` before a provider call.

### 5g. WhatsApp delivery proof (only if enabled)

1. Configure Meta's webhook to `/api/webhooks/whatsapp` and verify the challenge.
2. Send a controlled approved template or in-window reply.
3. Confirm `messages_outbound.provider_message_id` is populated only after Meta accepts it.
4. Confirm `whatsapp_delivery_events` records the signed `sent`/`delivered`/`read` receipt.

### 5h. Hermes proxy (if HERMES_API_URL is set)

```bash
curl -s -X POST https://<app>/api/hermes/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"messages":[{"role":"user","content":"ping"}]}'
# Expect: streaming JSON or {"role":"assistant","content":"..."}
# Must NOT return a 401 or 500 on a valid session.
```

---

## 6. Notify team

Post in the team channel once smoke checks pass:

```
[DEPLOY] Hermes Sourcing deployed to production
Commit: <short SHA>
Deploy URL: https://<app>/
Smoke checks: PASS
Deployed by: <name>
Time: <UTC timestamp>
```

---

## Deployment checklist (quick reference)

- [ ] `npm run typecheck` → exit 0
- [ ] `npm run lint` → no errors
- [ ] `npm run test` → 0 failures
- [ ] `npm run build` (CI or unsynced checkout) or `npm run build:isolated` (OneDrive checkout) → no errors
- [ ] DB migrations applied and RLS confirmed
- [ ] All required env vars set in Vercel
- [ ] `git push origin main` or `vercel --prod`
- [ ] Auth flow smoke check passed
- [ ] Critical routes all load
- [ ] CSP header present
- [ ] No console errors on `/floor`, `/fleet`, `/settings`
- [ ] Outreach approval gate visible
- [ ] Team notified
