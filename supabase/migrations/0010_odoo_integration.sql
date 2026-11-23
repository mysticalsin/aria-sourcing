-- ARIA <-> Odoo (ADR 0003, docs/odoo.md).
--
-- Odoo is the system of record for recruitment (job positions, applications,
-- interviews, hires). ARIA keeps three things on its side:
--   odoo_connections      the admin-configured Odoo instance per workspace
--                         (API key encrypted by the app before it lands here)
--   odoo_job_links        which ARIA campaign feeds which Odoo job position
--   odoo_applicant_links  which ARIA candidate became which Odoo applicant.
--                         The row is claimed ('pending') before Odoo is called,
--                         so two clicks never create two applicants.
-- Service role only, like the other server-owned tables; routes authenticate
-- the user, check the role and scope every query to the user's workspace.

create table public.odoo_connections (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  base_url text not null check (base_url ~ '^https?://[^\s?#]+$' and char_length(base_url) <= 300),
  public_url text check (public_url is null or (public_url ~ '^https?://[^\s?#]+$' and char_length(public_url) <= 300)),
  database_name text not null check (database_name ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$'),
  api_key_secret text not null check (char_length(api_key_secret) between 1 and 4000),
  api_key_last4 text not null check (char_length(api_key_last4) <= 4),
  odoo_version text check (char_length(odoo_version) <= 40),
  odoo_user_name text check (char_length(odoo_user_name) <= 200),
  stage_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(stage_map) = 'object' and pg_column_size(stage_map) < 8192),
  config_revision integer not null default 1 check (config_revision > 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_error text check (char_length(last_error) <= 500)
);

create table public.odoo_job_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 100),
  job_id integer not null check (job_id > 0),
  job_name text check (char_length(job_name) <= 300),
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (workspace_id, campaign_id)
);

create table public.odoo_applicant_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id text not null check (char_length(candidate_id) between 1 and 100),
  campaign_id text not null check (char_length(campaign_id) between 1 and 100),
  job_id integer not null check (job_id > 0),
  -- pending: claimed, the Odoo call is in flight (or the server died during
  -- it: the next attempt looks the person up in Odoo before creating).
  state text not null default 'pending' check (state in ('pending', 'linked')),
  applicant_id integer check (applicant_id > 0),
  odoo_stage text check (char_length(odoo_stage) <= 200),
  odoo_status text check (odoo_status in ('ongoing', 'hired', 'refused', 'archived', 'deleted')),
  claimed_at timestamptz not null default now(),
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz,
  synced_at timestamptz,
  primary key (workspace_id, candidate_id),
  check (state = 'pending' or applicant_id is not null)
);
create index odoo_applicant_links_campaign on public.odoo_applicant_links(workspace_id, campaign_id);

do $aria_odoo_privileges$
declare
  target text;
begin
  foreach target in array array['odoo_connections', 'odoo_job_links', 'odoo_applicant_links'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('alter table public.%I force row level security', target);
    execute format('revoke all on public.%I from public, anon, authenticated, authenticator', target);
    execute format('grant select, insert, update, delete on public.%I to service_role', target);
    execute format(
      'create policy %I on public.%I to postgres, supabase_admin using (true) with check (true)',
      target || '_owner', target
    );
  end loop;
end
$aria_odoo_privileges$;

-- The candidate as the workspace knows it, with its campaign title, for the
-- hand-off. Read by the service only: the browser never supplies the profile.
create function public.odoo_candidate_record(p_workspace_id uuid, p_candidate_id text)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
           'candidate', c,
           'campaignTitle', (
             select camp->>'title'
               from jsonb_array_elements(coalesce(ws.state->'campaigns', '[]'::jsonb)) camp
              where camp->>'id' = c->>'campaignId'
              limit 1
           )
         )
    from public.workspace_state ws,
         jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) c
   where ws.workspace_id = p_workspace_id
     and c->>'id' = p_candidate_id
   limit 1
$$;
revoke all on function public.odoo_candidate_record(uuid, text) from public, anon, authenticated;
grant execute on function public.odoo_candidate_record(uuid, text) to service_role;
