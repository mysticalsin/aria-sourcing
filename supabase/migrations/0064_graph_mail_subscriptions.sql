-- 0064_graph_mail_subscriptions.sql
-- Microsoft Graph webhook subscriptions for Outlook mail (no inbox polling).
-- One active subscription per email_connection; client_state verifies notifications.

create table if not exists public.graph_mail_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.email_connections(id) on delete cascade,
  graph_subscription_id text not null,
  resource text not null default '/me/mailFolders(''inbox'')/messages',
  change_types text not null default 'created',
  notification_url text not null,
  client_state_hash text not null,
  expires_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'expired', 'deleted', 'error')),
  last_notification_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id),
  unique (graph_subscription_id)
);

create index if not exists graph_mail_subscriptions_workspace_idx
  on public.graph_mail_subscriptions (workspace_id);
create index if not exists graph_mail_subscriptions_expires_idx
  on public.graph_mail_subscriptions (expires_at)
  where status = 'active';

revoke all on table public.graph_mail_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.graph_mail_subscriptions to service_role;

comment on table public.graph_mail_subscriptions is
  'Microsoft Graph change-notification subscriptions for Outlook Inbox. Aria never polls mailboxes for the recruiting loop.';
