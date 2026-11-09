-- Agents runner (ADR 0002, owner decisions 2026-11-09).
--
-- * agent_delegations: a user lets the agents act on their behalf
--   (one row per workspace and user, revocable).
-- * agent_campaign_autopilots: the standing approval a campaign owner signs
--   for one campaign: nightly sourcing, then up to N of the best eligible
--   candidates contacted on LinkedIn from that owner's paired account,
--   without a click per message. One owner per campaign.
-- * agent_missions: one row per mission run (steps, cost, outcome). Never
--   candidate content.
-- * agent_outreach: one row per candidate the agent decided to contact, and
--   where that contact stands (drafted, waiting for the LinkedIn look-up,
--   queued, sent, skipped, failed). Unique per campaign and candidate, so a
--   candidate is never contacted twice by the agent.
--
-- Service role only, like the other server-owned tables: routes authenticate
-- the user (cookie) or the runner (AGENT_RUNNER_SECRET) and scope every query.

create table public.agent_delegations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scopes text[] not null default array['source', 'draft', 'queue_linkedin']::text[]
    check (scopes <@ array['source', 'draft', 'queue_linkedin', 'send_email']::text[]),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.agent_campaign_autopilots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 100),
  owner_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  -- Sourcing
  source_every_hours integer not null default 24 check (source_every_hours between 1 and 168),
  source_limit integer not null default 8 check (source_limit between 1 and 20),
  -- Contact
  contact_enabled boolean not null default true,
  contacts_per_run integer not null default 3 check (contacts_per_run between 1 and 5),
  min_score integer not null default 70 check (min_score between 0 and 100),
  approved_at timestamptz not null default now(),
  last_source_at timestamptz,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, campaign_id)
);
create index agent_campaign_autopilots_due on public.agent_campaign_autopilots(enabled, last_source_at);

create table public.agent_missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 100),
  on_behalf_of uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('source', 'contact')),
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed', 'skipped')),
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and pg_column_size(steps) < 32768),
  sourcing_job_id uuid,
  summary text check (char_length(summary) <= 500),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index agent_missions_campaign on public.agent_missions(workspace_id, campaign_id, started_at desc);

create table public.agent_outreach (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 100),
  candidate_id text not null check (char_length(candidate_id) between 1 and 100),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid references public.agent_missions(id) on delete set null,
  message_id text check (char_length(message_id) <= 100),
  state text not null default 'selected'
    check (state in ('selected', 'awaiting_lookup', 'queued', 'sent', 'skipped', 'failed')),
  kind text check (kind in ('message', 'invitation')),
  outbox_id uuid,
  score integer check (score between 0 and 100),
  reason text check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, campaign_id, candidate_id)
);
create index agent_outreach_open on public.agent_outreach(workspace_id, state);

do $aria_agents_rls$
declare
  t text;
begin
  foreach t in array array['agent_delegations', 'agent_campaign_autopilots', 'agent_missions', 'agent_outreach'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, authenticator', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('create policy %I on public.%I to postgres, supabase_admin using (true) with check (true)', t || '_owner', t);
  end loop;
end
$aria_agents_rls$;
