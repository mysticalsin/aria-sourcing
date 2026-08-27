-- 0067_mcp_allowlist_select_grants.sql
--
-- 0056 created mcp_server_allowlist + RLS SELECT policy, but never GRANTed
-- SELECT to authenticated/service_role. PostgREST then returns 42501, so
-- /api/mcp/test cannot see allowlisted rows and production discovery stays
-- fail-closed even after a successful upsert_mcp_allowlist_entry.

grant select on public.mcp_server_allowlist to authenticated;
grant select on public.mcp_server_allowlist to service_role;
