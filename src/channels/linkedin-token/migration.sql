-- LinkedIn session-token channel (off until an owner or admin records the risk notice).
-- Ships with src/channels/linkedin-token so it can be applied on either base.
-- The running app uses this shape in SQLite for local proof. Postgres installs
-- the same tables; service role only. The token column holds AES-GCM ciphertext.

create table if not exists public.linkedin_token_workspace (
  workspace_id text primary key,
  enabled boolean not null default false,
  acknowledgement text,
  acknowledged_by text,
  acknowledged_at timestamptz,
  token_ciphertext text,
  paused boolean not null default false,
  pause_reason text,
  killed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.linkedin_token_queue (
  id text primary key,
  workspace_id text not null references public.linkedin_token_workspace(workspace_id) on delete cascade,
  status text not null check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled', 'unknown')),
  recipient text not null,
  subject text not null,
  body text not null,
  nonce text not null,
  sender_id text not null,
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.linkedin_token_audit (
  id text primary key,
  workspace_id text not null,
  action text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.linkedin_token_workspace enable row level security;
alter table public.linkedin_token_queue enable row level security;
alter table public.linkedin_token_audit enable row level security;
revoke all on public.linkedin_token_workspace, public.linkedin_token_queue, public.linkedin_token_audit from public, anon, authenticated;
