-- 0081_computer_audits.sql
--
-- Durable, tenant-scoped audit trail for OpenBot / Fleet Chromium computers.
-- Covers ensure/start/stop/takeover/release/help/jobs — operator + bot actors.
-- Complements contact_leases (send authority); this table is observability only.

create table if not exists public.computer_audits (
  -- App-generated ids (caud_…) — text PK so inserts never depend on gen_random_uuid().
  id              text primary key,
  workspace_id    text not null,
  computer_id     text not null,
  seat_id         text,
  action          text not null,
  detail          text not null default '',
  actor           text not null
    check (actor in ('bot', 'human', 'system')),
  correlation_id  text,
  job_id          text,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists computer_audits_workspace_created_idx
  on public.computer_audits (workspace_id, created_at desc);

create index if not exists computer_audits_computer_created_idx
  on public.computer_audits (workspace_id, computer_id, created_at desc);

create index if not exists computer_audits_action_idx
  on public.computer_audits (workspace_id, action, created_at desc);

create index if not exists computer_audits_correlation_idx
  on public.computer_audits (workspace_id, correlation_id)
  where correlation_id is not null;

comment on table public.computer_audits is
  'Append-only Fleet / OpenBot computer audit events for operator tracking and compliance export.';

alter table public.computer_audits enable row level security;

revoke all on public.computer_audits from anon, public;
grant select on public.computer_audits to authenticated;
grant select, insert on public.computer_audits to service_role;

-- Members read only their workspace (workspace_id may be uuid text or __local__).
drop policy if exists "members read computer_audits" on public.computer_audits;
create policy "members read computer_audits"
  on public.computer_audits for select
  using (
    workspace_id = coalesce(public.current_workspace_id()::text, '')
  );

-- Inserts go through service role from the app (ComputerSupervisor sink).
drop policy if exists "service insert computer_audits" on public.computer_audits;
-- service_role bypasses RLS; no insert policy for authenticated by design.
