-- 0082_campaign_agent_bindings.sql
--
-- Persist campaign ↔ Browser Computer seat membership, and tag computer audits
-- with optional campaign_id so Campaign Agents can show a durable trail on Fly.

alter table public.agent_seats
  add column if not exists assigned_campaign_ids text[] not null default '{}'::text[];

comment on column public.agent_seats.assigned_campaign_ids is
  'Campaign ids this Browser Computer seat is attached to (Campaign Agents tab). Soft membership; multi-campaign allowed.';

create index if not exists agent_seats_assigned_campaign_ids_gin
  on public.agent_seats using gin (assigned_campaign_ids);

alter table public.computer_audits
  add column if not exists campaign_id text;

create index if not exists computer_audits_campaign_created_idx
  on public.computer_audits (workspace_id, campaign_id, created_at desc)
  where campaign_id is not null;

comment on column public.computer_audits.campaign_id is
  'Optional campaign scope when the action originated from Campaign Agents (or a campaign-tagged job).';
