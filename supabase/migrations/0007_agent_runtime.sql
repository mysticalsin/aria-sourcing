-- 0007_agent_runtime.sql
-- On-demand sourcing agents: specs, resumable runs, append-only event stream,
-- and the two-sided message ledger that backs the human-likeness gate and gated
-- autopilot. Run AFTER 0006.
--
-- Safety architecture (mirrors the never-auto-send posture of 0006):
--   * agent_events is the ONLY place agent narration/status lives. Nothing in
--     the send path reads it — an AI "thinking/status" line physically cannot
--     reach a candidate.
--   * messages_outbound.type is constrained to the two shapes allowed on the
--     wire ('candidate_reply' | 'approved_template'). The send route refuses
--     anything else; autopilot auto-approval additionally requires a matching
--     outreach_approvals row, same as a human approval (see /api/outreach/send).
--   * dedupe_hash is UNIQUE per workspace — the same text can never be sent to
--     the same candidate twice, even across concurrent runs.

-- ============================================================================
-- agent_specs — a parameterizable, single-task sourcing agent definition
-- ============================================================================
create table if not exists public.agent_specs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  owner_id            uuid not null references auth.users(id),
  name                text not null,
  -- Role brief: same shape as Campaign.jobAnalysis (title, seniority, skills, …)
  role_brief          jsonb not null,
  channels            text[] not null default '{Email}',
  -- Guardrails: { autopilot: bool, topics_allow: string[], quiet_hours: {start,end},
  --   max_per_day: int, canary_remaining: int }
  guardrails          jsonb not null default '{"autopilot": false, "canary_remaining": 5}',
  flowise_chatflow_id text,
  -- Sender identity for this agent's outbound (live agent_seats row). The
  -- autopilot dispatcher refuses to send without a live seat.
  seat_id             uuid references public.agent_seats(id) on delete set null,
  status              text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ============================================================================
-- agent_runs — one resumable execution of a spec (deer-flow-style state machine)
-- State is persisted after EVERY node so a serverless timeout is a resume,
-- not a failure.
-- ============================================================================
create table if not exists public.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  spec_id       uuid not null references public.agent_specs(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  node          text not null default 'planner'
                check (node in ('planner', 'sourcer', 'screener', 'outreach', 'reporter', 'done')),
  state_json    jsonb not null default '{}',
  step_count    int not null default 0,
  status        text not null default 'running'
                check (status in ('running', 'awaiting_gate', 'done', 'failed')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists agent_runs_spec_idx on public.agent_runs (spec_id, started_at desc);

-- ============================================================================
-- agent_events — append-only narration/status stream. NO send path reads this.
-- ============================================================================
create table if not exists public.agent_events (
  id            bigint generated always as identity primary key,
  run_id        uuid not null references public.agent_runs(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  at            timestamptz not null default now(),
  type          text not null,
  payload       jsonb not null default '{}'
);

create index if not exists agent_events_run_idx on public.agent_events (run_id, at);

-- ============================================================================
-- messages_outbound — everything that WANTS to reach a candidate, gated.
-- status flow: composed → queued (passed gate, scheduled) | blocked (queued
-- for human review) → sent | failed
-- ============================================================================
create table if not exists public.messages_outbound (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  spec_id       uuid references public.agent_specs(id) on delete set null,
  run_id        uuid references public.agent_runs(id) on delete set null,
  candidate_id  text not null,
  seat_id       uuid references public.agent_seats(id) on delete set null,
  channel       text not null check (channel in ('Email', 'LinkedIn', 'WhatsApp', 'SMS')),
  -- Destination (E.164 phone or email). Also how an inbound reply is threaded
  -- back to its candidate/spec: latest outbound with to_address = inbound.from.
  to_address    text not null default '',
  type          text not null check (type in ('candidate_reply', 'approved_template')),
  subject       text not null default '',
  body          text not null,
  status        text not null default 'composed'
                check (status in ('composed', 'queued', 'blocked', 'sent', 'failed')),
  gate_result   jsonb,
  dedupe_hash   text not null,
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (workspace_id, dedupe_hash)
);

create index if not exists messages_outbound_status_idx
  on public.messages_outbound (workspace_id, status, created_at desc);
create index if not exists messages_outbound_due_idx
  on public.messages_outbound (status, scheduled_at);
create index if not exists messages_outbound_thread_idx
  on public.messages_outbound (workspace_id, to_address, created_at desc);

-- ============================================================================
-- messages_inbound — candidate replies (WhatsApp webhook, email sync)
-- ============================================================================
create table if not exists public.messages_inbound (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  candidate_id  text,
  channel       text not null check (channel in ('Email', 'LinkedIn', 'WhatsApp', 'SMS')),
  from_address  text not null,
  body          text not null,
  provider_id   text,
  received_at   timestamptz not null default now(),
  processed     boolean not null default false,
  unique (workspace_id, channel, provider_id)
);

create index if not exists messages_inbound_unprocessed_idx
  on public.messages_inbound (workspace_id, processed, received_at);

-- ============================================================================
-- RLS — same posture as 0005: no anon, workspace-scoped for authenticated,
-- append-only where the table is an audit surface.
-- ============================================================================
alter table public.agent_specs       enable row level security;
alter table public.agent_runs        enable row level security;
alter table public.agent_events      enable row level security;
alter table public.messages_outbound enable row level security;
alter table public.messages_inbound  enable row level security;

revoke all on public.agent_specs       from anon, public;
revoke all on public.agent_runs        from anon, public;
revoke all on public.agent_events      from anon, public;
revoke all on public.messages_outbound from anon, public;
revoke all on public.messages_inbound  from anon, public;

grant select, insert, update on public.agent_specs       to authenticated;
grant select, insert, update on public.agent_runs        to authenticated;
grant select, insert         on public.agent_events      to authenticated;
grant select, insert, update on public.messages_outbound to authenticated;
grant select, insert, update on public.messages_inbound  to authenticated;

-- agent_specs: members manage their own workspace's agents.
drop policy if exists agent_specs_select on public.agent_specs;
create policy agent_specs_select on public.agent_specs
  for select using (workspace_id = public.current_workspace_id());

drop policy if exists agent_specs_insert on public.agent_specs;
create policy agent_specs_insert on public.agent_specs
  for insert with check (
    workspace_id = public.current_workspace_id() and owner_id = auth.uid()
  );

drop policy if exists agent_specs_update on public.agent_specs;
create policy agent_specs_update on public.agent_specs
  for update using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- agent_runs: workspace-scoped read/write (runs are driven server-side).
drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs
  for select using (workspace_id = public.current_workspace_id());

drop policy if exists agent_runs_insert on public.agent_runs;
create policy agent_runs_insert on public.agent_runs
  for insert with check (workspace_id = public.current_workspace_id());

drop policy if exists agent_runs_update on public.agent_runs;
create policy agent_runs_update on public.agent_runs
  for update using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- agent_events: append-only audit trail — INSERT + SELECT only, like
-- outreach_ledger in 0005. No UPDATE/DELETE policies exist on purpose.
drop policy if exists agent_events_select on public.agent_events;
create policy agent_events_select on public.agent_events
  for select using (workspace_id = public.current_workspace_id());

drop policy if exists agent_events_insert on public.agent_events;
create policy agent_events_insert on public.agent_events
  for insert with check (workspace_id = public.current_workspace_id());

-- messages_outbound / messages_inbound: workspace-scoped.
drop policy if exists messages_outbound_select on public.messages_outbound;
create policy messages_outbound_select on public.messages_outbound
  for select using (workspace_id = public.current_workspace_id());

drop policy if exists messages_outbound_insert on public.messages_outbound;
create policy messages_outbound_insert on public.messages_outbound
  for insert with check (workspace_id = public.current_workspace_id());

drop policy if exists messages_outbound_update on public.messages_outbound;
create policy messages_outbound_update on public.messages_outbound
  for update using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

drop policy if exists messages_inbound_select on public.messages_inbound;
create policy messages_inbound_select on public.messages_inbound
  for select using (workspace_id = public.current_workspace_id());

drop policy if exists messages_inbound_insert on public.messages_inbound;
create policy messages_inbound_insert on public.messages_inbound
  for insert with check (workspace_id = public.current_workspace_id());

drop policy if exists messages_inbound_update on public.messages_inbound;
create policy messages_inbound_update on public.messages_inbound
  for update using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());
