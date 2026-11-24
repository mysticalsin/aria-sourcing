-- Experimental LinkedIn bridge (off unless LINKEDIN_BRIDGE_ENABLED=true).
--
-- A user pairs the ARIA Chrome extension with their ARIA account. The
-- extension reads that user's LinkedIn inbox and sends the messages the user
-- writes in ARIA, from the user's own browser session. No LinkedIn cookie,
-- password or session token is ever stored here: only the hash of the ARIA
-- pairing token, the synced conversations and the outbox.
--
-- A LinkedIn inbox is personal: every row hangs off one (workspace, user)
-- account and the API only ever serves the signed-in owner. Service role only,
-- like the other server-owned tables; routes authenticate and scope.

create table public.linkedin_bridge_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  paired_at timestamptz not null default now(),
  member_id text check (member_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  display_name text check (char_length(display_name) <= 200),
  public_identifier text check (char_length(public_identifier) <= 200),
  identity_checked_at timestamptz,
  query_ids jsonb not null default '{}'::jsonb
    check (jsonb_typeof(query_ids) = 'object' and pg_column_size(query_ids) < 16384),
  extension_version text check (char_length(extension_version) <= 40),
  session_present boolean not null default false,
  last_seen_at timestamptz,
  last_inbox_sync_at timestamptz,
  backoff_until timestamptz,
  last_error text check (char_length(last_error) <= 500),
  last_error_at timestamptz,
  unique (workspace_id, user_id)
);

create table public.linkedin_bridge_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_bridge_accounts(id) on delete cascade,
  conversation_urn text not null check (char_length(conversation_urn) <= 400),
  title text check (char_length(title) <= 300),
  participants jsonb not null default '[]'::jsonb check (jsonb_typeof(participants) = 'array'),
  group_chat boolean not null default false,
  last_activity_at timestamptz,
  unread boolean not null default false,
  last_message_preview text check (char_length(last_message_preview) <= 500),
  needs_message_sync boolean not null default true,
  messages_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, conversation_urn)
);
create index linkedin_bridge_conversations_recent
  on public.linkedin_bridge_conversations(account_id, last_activity_at desc nulls last);

create table public.linkedin_bridge_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_bridge_accounts(id) on delete cascade,
  conversation_id uuid not null references public.linkedin_bridge_conversations(id) on delete cascade,
  message_urn text not null check (char_length(message_urn) <= 400),
  sender_member_id text check (char_length(sender_member_id) <= 120),
  sender_name text check (char_length(sender_name) <= 200),
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null check (char_length(body) <= 20001),
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (account_id, message_urn)
);
create index linkedin_bridge_messages_thread on public.linkedin_bridge_messages(conversation_id, sent_at);

create table public.linkedin_bridge_outbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_bridge_accounts(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.linkedin_bridge_conversations(id) on delete set null,
  conversation_urn text check (char_length(conversation_urn) <= 400),
  recipient_public_id text check (char_length(recipient_public_id) <= 100),
  recipient_member_id text check (recipient_member_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  recipient_name text check (char_length(recipient_name) <= 200),
  candidate_id text check (char_length(candidate_id) <= 100),
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  -- queued -> (resolving -> queued) -> sending -> sent | failed | unknown.
  -- "unknown": the extension took the message but never confirmed; it may or
  -- may not have left, so it is never retried automatically.
  status text not null default 'queued'
    check (status in ('queued', 'resolving', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
  claim_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 10),
  error text check (char_length(error) <= 500),
  sent_message_urn text check (char_length(sent_message_urn) <= 400),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (conversation_urn is not null or recipient_public_id is not null or recipient_member_id is not null)
);
create index linkedin_bridge_outbox_queue on public.linkedin_bridge_outbox(account_id, status, created_at);
create index linkedin_bridge_outbox_sent on public.linkedin_bridge_outbox(account_id, sent_at) where status = 'sent';

do $aria_linkedin_bridge_privileges$
declare
  target text;
begin
  foreach target in array array[
    'linkedin_bridge_accounts',
    'linkedin_bridge_conversations',
    'linkedin_bridge_messages',
    'linkedin_bridge_outbox'
  ] loop
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
$aria_linkedin_bridge_privileges$;
