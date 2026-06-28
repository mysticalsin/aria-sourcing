-- 0006_outreach_approvals.sql
-- Server-side record of human approvals for outbound outreach. /api/outreach/send
-- refuses to send a message that lacks a matching approval (by message_id +
-- body_hash), so the human-approval gate ("never auto-send") is enforced
-- server-side, not only in the browser. Run AFTER 0005.

create table if not exists public.outreach_approvals (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  message_id    text not null,
  body_hash     text not null,
  approved_by   uuid not null references auth.users(id),
  approved_at   timestamptz not null default now(),
  unique (workspace_id, message_id)
);

create index if not exists outreach_approvals_ws_msg_idx
  on public.outreach_approvals (workspace_id, message_id);

alter table public.outreach_approvals enable row level security;

revoke all on public.outreach_approvals from anon, public;
grant select, insert, update on public.outreach_approvals to authenticated;

-- Members read their own workspace's approvals (audit trail).
drop policy if exists outreach_approvals_select on public.outreach_approvals;
create policy outreach_approvals_select on public.outreach_approvals
  for select using (workspace_id = public.current_workspace_id());

-- A member records an approval for their own workspace, as themselves. The route
-- additionally enforces the `outreach` permission.
drop policy if exists outreach_approvals_insert on public.outreach_approvals;
create policy outreach_approvals_insert on public.outreach_approvals
  for insert with check (
    workspace_id = public.current_workspace_id() and approved_by = auth.uid()
  );

drop policy if exists outreach_approvals_update on public.outreach_approvals;
create policy outreach_approvals_update on public.outreach_approvals
  for update using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id() and approved_by = auth.uid());
