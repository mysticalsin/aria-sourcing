-- LinkedIn bridge, centred on sourced candidates (owner request 2026-11-06).
--
-- * A LinkedIn account belongs to one ARIA user.
-- * The bridge follows candidates: a contact row per (pairing, candidate)
--   holds the candidate's LinkedIn member id and where they stand with the
--   user (connected, invitation pending, neither).
-- * The outbox also carries connection invitations (note of 300 characters
--   at most, possibly empty).
-- * Only conversations with a candidate are kept in full. Every other
--   conversation shrinks to a stub (participant member ids and last activity,
--   no names, no text) so a candidate looked up later can still be matched.

-- One LinkedIn account, one ARIA user.
create unique index linkedin_bridge_accounts_member
  on public.linkedin_bridge_accounts(member_id) where member_id is not null;

create table public.linkedin_bridge_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_bridge_accounts(id) on delete cascade,
  candidate_id text not null check (char_length(candidate_id) between 1 and 100),
  -- The public id from the candidate's LinkedIn URL (jane-doe), or a member id.
  identity text not null check (char_length(identity) between 1 and 100),
  member_id text check (member_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  display_name text check (char_length(display_name) <= 200),
  headline text check (char_length(headline) <= 300),
  relationship text not null default 'unknown'
    check (relationship in ('unknown', 'connected', 'pending', 'none', 'not_found')),
  lookup_requested boolean not null default true,
  checked_at timestamptz,
  lookup_error text check (char_length(lookup_error) <= 300),
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, candidate_id)
);
create index linkedin_bridge_contacts_member on public.linkedin_bridge_contacts(account_id, member_id);
create index linkedin_bridge_contacts_due on public.linkedin_bridge_contacts(account_id, lookup_requested, checked_at);

alter table public.linkedin_bridge_contacts enable row level security;
alter table public.linkedin_bridge_contacts force row level security;
revoke all on public.linkedin_bridge_contacts from public, anon, authenticated, authenticator;
grant select, insert, update, delete on public.linkedin_bridge_contacts to service_role;
create policy linkedin_bridge_contacts_owner on public.linkedin_bridge_contacts
  to postgres, supabase_admin using (true) with check (true);

-- Outbox: messages and invitations.
alter table public.linkedin_bridge_outbox
  add column kind text not null default 'message' check (kind in ('message', 'invitation')),
  add column contact_id uuid references public.linkedin_bridge_contacts(id) on delete set null;

do $aria_linkedin_outbox_body$
declare
  target record;
begin
  for target in
    select conname from pg_constraint
     where conrelid = 'public.linkedin_bridge_outbox'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%btrim(body)%'
  loop
    execute format('alter table public.linkedin_bridge_outbox drop constraint %I', target.conname);
  end loop;
end
$aria_linkedin_outbox_body$;

alter table public.linkedin_bridge_outbox add constraint linkedin_bridge_outbox_body_by_kind check (
  (kind = 'message' and char_length(btrim(body)) between 1 and 8000)
  or (kind = 'invitation' and char_length(body) <= 300)
);
create index linkedin_bridge_outbox_writes on public.linkedin_bridge_outbox(account_id, kind, updated_at);

-- Conversations: which candidate they are with (null = stub).
alter table public.linkedin_bridge_conversations
  add column candidate_id text check (char_length(candidate_id) <= 100);
create index linkedin_bridge_conversations_candidate on public.linkedin_bridge_conversations(account_id, candidate_id);

-- No contact exists yet: every conversation synced so far becomes a stub.
-- (A cache of LinkedIn: candidates' conversations come back on the next sync
-- once they are looked up.)
delete from public.linkedin_bridge_messages;
update public.linkedin_bridge_conversations
   set title = null,
       last_message_preview = null,
       last_message_sender = null,
       last_message_direction = null,
       unread = false,
       needs_message_sync = false,
       messages_synced_at = null,
       participants = coalesce(
         (select jsonb_agg(jsonb_build_object('memberId', p->>'memberId'))
            from jsonb_array_elements(participants) p
           where p->>'memberId' is not null),
         '[]'::jsonb),
       updated_at = now();

-- The candidate as the workspace knows it: the LinkedIn URL and the
-- contact-blocking flags. Read by the service only.
create function public.linkedin_bridge_candidate(p_workspace_id uuid, p_candidate_id text)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
           'id', c->>'id',
           'name', c->>'name',
           'linkedinUrl', coalesce(c->>'linkedinUrl', ''),
           'complianceFlags', coalesce(c->'complianceFlags', '{}'::jsonb)
         )
    from public.workspace_state ws,
         jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) c
   where ws.workspace_id = p_workspace_id
     and c->>'id' = p_candidate_id
   limit 1
$$;
revoke all on function public.linkedin_bridge_candidate(uuid, text) from public, anon, authenticated;
grant execute on function public.linkedin_bridge_candidate(uuid, text) to service_role;
