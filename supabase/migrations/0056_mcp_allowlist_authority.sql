-- 0056_mcp_allowlist_authority.sql
--
-- Production MCP moves from hard-off to admin-managed per-tenant allowlist.
-- Without an allowlisted row, discovery and execution remain fail-closed.
-- No silent wildcards. Secrets stay in api_keys vault via encrypted_secret_id.

create table if not exists public.mcp_server_allowlist (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  name                  text not null,
  base_url              text not null,
  base_url_host         text not null,
  tool_manifest_sha256  text not null,
  encrypted_secret_id   uuid,
  max_tools             integer not null default 16
    check (max_tools between 1 and 16),
  enabled               boolean not null default false,
  created_by            uuid not null,
  updated_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint mcp_server_allowlist_name_len check (char_length(name) between 1 and 200),
  constraint mcp_server_allowlist_url_https check (base_url ~* '^https://'),
  constraint mcp_server_allowlist_manifest_hash check (tool_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint mcp_server_allowlist_workspace_url_uniq unique (workspace_id, base_url),
  constraint mcp_server_allowlist_created_by_fk
    foreign key (workspace_id, created_by)
    references public.profiles (workspace_id, id)
    on delete restrict,
  constraint mcp_server_allowlist_updated_by_fk
    foreign key (workspace_id, updated_by)
    references public.profiles (workspace_id, id)
    on delete restrict
);

create index if not exists mcp_server_allowlist_workspace_enabled_idx
  on public.mcp_server_allowlist (workspace_id, enabled);

alter table public.mcp_server_allowlist enable row level security;

drop policy if exists "mcp allowlist read" on public.mcp_server_allowlist;
create policy "mcp allowlist read" on public.mcp_server_allowlist
  for select using (workspace_id = public.current_workspace_id());

revoke insert, update, delete on public.mcp_server_allowlist from anon, authenticated;

create or replace function public.upsert_mcp_allowlist_entry(
  p_name text,
  p_base_url text,
  p_tool_manifest_sha256 text,
  p_encrypted_secret_id uuid,
  p_max_tools integer,
  p_enabled boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  host text;
  entry_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  if p_name is null or char_length(btrim(p_name)) < 1
     or p_base_url is null or p_base_url !~* '^https://'
     or p_tool_manifest_sha256 is null or p_tool_manifest_sha256 !~ '^[0-9a-f]{64}$'
     or p_max_tools is null or p_max_tools not between 1 and 16
     or p_enabled is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  begin
    host := lower(substring(p_base_url from '^https://([^/?:#]+)'));
  exception when others then
    return jsonb_build_object('status', 'invalid_url');
  end;
  if host is null or host = '' then
    return jsonb_build_object('status', 'invalid_url');
  end if;

  insert into public.mcp_server_allowlist (
    workspace_id, name, base_url, base_url_host, tool_manifest_sha256,
    encrypted_secret_id, max_tools, enabled, created_by, updated_by
  ) values (
    caller_workspace, btrim(p_name), p_base_url, host, p_tool_manifest_sha256,
    p_encrypted_secret_id, p_max_tools, p_enabled, auth.uid(), auth.uid()
  )
  on conflict (workspace_id, base_url) do update
    set name = excluded.name,
        base_url_host = excluded.base_url_host,
        tool_manifest_sha256 = excluded.tool_manifest_sha256,
        encrypted_secret_id = excluded.encrypted_secret_id,
        max_tools = excluded.max_tools,
        enabled = excluded.enabled,
        updated_by = auth.uid(),
        updated_at = now()
  returning id into entry_id;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
  values (
    caller_workspace,
    'mcp.allowlist_upserted',
    'mcp_server_allowlist',
    entry_id::text,
    jsonb_build_object(
      'actor_id', auth.uid()::text,
      'base_url_host', host,
      'enabled', p_enabled,
      'tool_manifest_sha256', p_tool_manifest_sha256
    )
  );

  return jsonb_build_object('status', 'ok', 'id', entry_id);
end;
$$;

create or replace function public.disable_mcp_allowlist_entry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  update public.mcp_server_allowlist
     set enabled = false,
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_id
     and workspace_id = caller_workspace;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok', 'id', p_id);
end;
$$;

-- service_role lookup used by mcp-client at execution time
create or replace function public.mcp_allowlist_permits(
  p_workspace_id uuid,
  p_base_url text,
  p_tool_manifest_sha256 text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.mcp_server_allowlist entry
     where entry.workspace_id = p_workspace_id
       and entry.base_url = p_base_url
       and entry.tool_manifest_sha256 = p_tool_manifest_sha256
       and entry.enabled is true
  );
$$;

revoke all on function public.upsert_mcp_allowlist_entry(text, text, text, uuid, integer, boolean)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.disable_mcp_allowlist_entry(uuid)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.mcp_allowlist_permits(uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;

grant execute on function public.upsert_mcp_allowlist_entry(text, text, text, uuid, integer, boolean) to authenticated;
grant execute on function public.disable_mcp_allowlist_entry(uuid) to authenticated;
grant execute on function public.mcp_allowlist_permits(uuid, text, text) to service_role;
