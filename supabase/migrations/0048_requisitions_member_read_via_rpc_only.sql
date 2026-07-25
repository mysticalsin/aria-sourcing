-- 0048_requisitions_member_read_via_rpc_only.sql
--
-- Close the direct-table read path on public.requisitions (Codex P2-22).
--
-- 0043 shipped `grant select on public.requisitions to authenticated`, which lets
-- a workspace member read the table directly and rely on RLS alone for scoping.
-- Members are supposed to read requisitions only through the bounded, current-
-- workspace-scoped list_workspace_requisitions(int, int) RPC, which is the
-- surface the privilege contract pins (tests/db/function-privileges.sql:145).
--
-- No application code selects from the table as `authenticated` — every read goes
-- through that RPC — so removing the grant is behaviour-preserving and removes a
-- redundant, RLS-only-defended read surface.
--
-- Append-only: 0043 is shipped and applied in production, so its bytes are not
-- edited. scripts/backup.sh derives EXPECTED_MIGRATION_IDENTITIES from file
-- sha256 and compares it against public.aria_schema_migrations, so editing a
-- shipped migration silently disables backups and the restore drill.

revoke all on public.requisitions from authenticated;
