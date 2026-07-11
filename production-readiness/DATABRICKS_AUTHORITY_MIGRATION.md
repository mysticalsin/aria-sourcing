# Databricks authority migration and recovery

Status: source-verified playbook. Static database contracts and application
authority tests pass, but migration `0019` has not been applied or rehearsed
against a real PostgreSQL clone in this workspace. Docker registry access and a
working local Docker backend were unavailable, so no live-database claim is made.

## Safety invariant

Databricks execution must use only `public.databricks_connections`. Never restore `workspace_state.state.settings.databricks` as an execution source, including during rollback.

The deployment must also set `DATABRICKS_ALLOWED_ORIGINS` to the exact canonical HTTPS Databricks workspace origin or comma-separated origins it owns. The application denies every credential-bearing Databricks request when this allowlist is absent, empty, malformed, or does not exactly match the stored origin.

## Before migration

1. Freeze Databricks intake calls.
2. Preserve production with a provider snapshot, volume clone, or equivalent,
   then prove a scratch restore. The repository backup and restore-drill scripts
   are for a reachable PostgreSQL/Docker target; they are not a substitute for
   Fly volume preservation.
3. Record row counts for `workspaces`, `workspace_state`, and `api_keys`.
4. Record which workspaces have a Databricks key, using metadata only. Do not export key values.
5. Configure `DATABRICKS_ALLOWED_ORIGINS` from deployment-controlled configuration. Do not source it from workspace state or an admin request.
6. Confirm the application release contains the normalized resolver and config API before unfreezing intake.

The legacy JSON is intentionally not copied into the normalized table because its writer cannot be proven to have been an admin.

## Apply and recover service

1. Apply migration `0019_agent_authority_and_integrations.sql` to a restored clone first.
2. Verify RLS and the composite key binding with admin, member, viewer, anonymous, foreign-workspace, and wrong-provider cases.
3. Deploy the application release that no longer reads Databricks configuration from shared state.
4. A workspace admin selects the existing Databricks key and explicitly saves the approved origin, warehouse, authentication mode, client ID, and needs query.
5. Execute one bounded intake request and verify one corresponding connection audit event.
6. Repeat the provider-backed preservation and scratch restore proof with both
   Databricks tables included. Use the repository scripts only on the disposable
   target they can reach.

## Safe operational rollback

If configuration or execution verification fails, disable the normalized connection. Keep the new authority boundary in place.

```sql
begin;

update public.databricks_connections
   set enabled = false
 where workspace_id = '<workspace-uuid>'::uuid;

commit;
```

The needs endpoint then fails closed as not configured. Investigate and forward-fix the normalized row before re-enabling it.

## Schema rollback on a disposable clone only

Use this only when rehearsing the migration before production data exists in the new tables. It is not a production rollback procedure.

```sql
begin;

drop trigger if exists workspace_state_strip_databricks_authority on public.workspace_state;
drop function if exists public.strip_legacy_databricks_authority();

drop trigger if exists databricks_connections_audit_authority on public.databricks_connections;
drop function if exists public.audit_databricks_connection_authority();

drop trigger if exists databricks_connections_stamp_authority on public.databricks_connections;
drop function if exists public.stamp_databricks_connection_authority();

drop table if exists public.databricks_connection_events;
drop table if exists public.databricks_connections;

alter table public.api_keys
  drop constraint if exists api_keys_id_workspace_provider_key;

rollback;
```

The final `rollback` is deliberate. Replace it with `commit` only on an approved disposable target after verifying that no retained evidence or connection rows are required.

## Evidence required before production

- Migration applies to a current restored clone without warnings.
- Member, viewer, and anonymous configuration DML is denied by PostgreSQL.
- Admin cross-workspace and wrong-provider bindings fail.
- Config changes produce append-only, non-secret events.
- Backup and restore manifests include `databricks_connections` and `databricks_connection_events`.
- Token-cache isolation is proven across workspace, connection revision, and key ID.
- Config save and execution both reject origins outside `DATABRICKS_ALLOWED_ORIGINS` before reading or sending a stored credential.
- Intake remains disabled until an admin completes explicit rebinding.

## Current local evidence

The source checks cover admin, member, viewer, anonymous, foreign-workspace,
wrong-provider, key-binding, audit immutability, legacy JSON stripping, final
routine privileges, and future-object default privileges for both the migration
owner and `supabase_admin`.

```bash
node --import tsx tests/databricks-database-contract.mts
node --import tsx tests/function-privileges-contract.mts
node --import tsx tests/databricks-intake.mts
node --import tsx tests/integration-authority.mts
```

The real PostgreSQL matrix remains mandatory:

```bash
npm run test:db-privileges
```

That command requires a functioning Docker backend and registry access. A green
static contract is not a substitute for this disposable-database execution or a
restored-clone rehearsal.
