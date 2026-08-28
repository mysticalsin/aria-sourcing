-- ============================================================================
-- Cloudflare Workers AI execution authority (admin-owned, workspace-scoped).
-- Account id + vault key binding — never store bearer tokens in workspace_state.
-- ============================================================================

create table if not exists public.cloudflare_connections (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null unique references public.workspaces(id) on delete cascade,
  account_id          text not null,
  api_key_id          uuid not null,
  credential_provider text not null default 'Cloudflare',
  default_model       text not null default '@cf/meta/llama-3.1-8b-instruct',
  models              jsonb not null default '[]'::jsonb,
  enabled             boolean not null default true,
  config_revision     bigint not null default 1,
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint cloudflare_connections_account_id_check
    check (length(btrim(account_id)) between 1 and 64),
  constraint cloudflare_connections_provider_check
    check (credential_provider = 'Cloudflare'),
  constraint cloudflare_connections_default_model_check
    check (length(btrim(default_model)) between 1 and 160),
  constraint cloudflare_connections_models_check
    check (jsonb_typeof(models) = 'array'),
  constraint cloudflare_connections_revision_check
    check (config_revision > 0),
  constraint cloudflare_connections_key_binding_fkey
    foreign key (api_key_id, workspace_id, credential_provider)
    references public.api_keys(id, workspace_id, provider)
    on delete restrict
);

alter table public.cloudflare_connections enable row level security;
alter table public.cloudflare_connections force row level security;

revoke all on public.cloudflare_connections
  from public, anon, authenticated, service_role, authenticator;
grant select, insert, update, delete on public.cloudflare_connections to authenticated;
grant select on public.cloudflare_connections to service_role;

drop policy if exists "members read Cloudflare connections" on public.cloudflare_connections;
create policy "members read Cloudflare connections"
  on public.cloudflare_connections for select
  using (workspace_id = public.current_workspace_id());

drop policy if exists "admins insert Cloudflare connections" on public.cloudflare_connections;
create policy "admins insert Cloudflare connections"
  on public.cloudflare_connections for insert
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins update Cloudflare connections" on public.cloudflare_connections;
create policy "admins update Cloudflare connections"
  on public.cloudflare_connections for update
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  )
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

drop policy if exists "admins delete Cloudflare connections" on public.cloudflare_connections;
create policy "admins delete Cloudflare connections"
  on public.cloudflare_connections for delete
  using (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );
