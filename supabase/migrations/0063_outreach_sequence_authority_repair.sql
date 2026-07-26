-- 0063_outreach_sequence_authority_repair.sql
--
-- Dark additive repair of the 0045 sequence authority. A new owner-only
-- release control defaults absent/false, so a tenant administrator cannot
-- activate sequence execution by setting sourcing_loop_controls alone. No
-- runtime calls these RPCs yet.
--
-- Fixes proven by tests/sequences-db.sh:
--   1. claim_sequence_step_for_schedule queried suppression_list.candidate_id,
--      a column that has never existed (0002 defines suppression by
--      workspace_id/type/value). The suppression check was therefore dead
--      code that would raise on first invocation. Replaced with a canonical
--      per-channel recipient identity resolved from public.candidates and
--      checked against suppression_list(type, value) the same way the
--      email/WhatsApp claim paths already do (0024).
--   2. Only ordinal 0 was ever marked due; nothing advanced later steps.
--      Fixed with an explicit due_at authority column plus two new
--      completion RPCs (one per verification source) that transactionally
--      advance the next step or complete the sequence.
--   3. The claim RPC scheduled every channel, including LinkedIn. LinkedIn
--      steps now transition due -> manual_task only, and are never bound to
--      an outbound row (bind_sequence_step_outbound already refuses any
--      non-'scheduled' step, so this is enforced structurally, not just by
--      caller discipline). Zero LinkedIn outbound/provider path.
--
-- Candidate erasure tombstones (0033) are rechecked at activation, claim,
-- and completion, on top of the existing delete-on-erasure trigger, so a
-- direct-DB or race-condition re-entry can never resurrect a suppressed
-- sequence. Missing or ambiguous recipient identity fails closed everywhere.

-- ---------------------------------------------------------------------------
-- 1. Due/verification/completion authority columns.
-- ---------------------------------------------------------------------------
alter table public.outreach_sequence_steps
  add column if not exists due_at timestamptz,
  add column if not exists verification_source text
    check (verification_source in ('operator_assertion', 'provider_confirmed')),
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid;

alter table public.outreach_sequence_steps
  drop constraint if exists outreach_sequence_steps_completed_at_check;
alter table public.outreach_sequence_steps
  add constraint outreach_sequence_steps_completed_at_check
  check (completed_at is null or status = 'sent');

alter table public.outreach_sequence_steps
  drop constraint if exists outreach_sequence_steps_completed_by_check;
alter table public.outreach_sequence_steps
  add constraint outreach_sequence_steps_completed_by_check
  check (completed_by is null or status = 'sent');

alter table public.outreach_sequence_steps
  drop constraint if exists outreach_sequence_steps_verification_source_check2;
alter table public.outreach_sequence_steps
  add constraint outreach_sequence_steps_verification_source_check2
  check (verification_source is null or status = 'sent');

update public.outreach_sequence_steps
   set due_at = coalesce(due_at, scheduled_at, now())
 where status = 'due' and due_at is null;

alter table public.outreach_sequence_steps
  drop constraint if exists outreach_sequence_steps_due_at_check;
alter table public.outreach_sequence_steps
  add constraint outreach_sequence_steps_due_at_check
  check (status <> 'due' or due_at is not null);

create index if not exists outreach_sequence_steps_due_at_idx
  on public.outreach_sequence_steps (status, due_at)
  where status = 'due';

-- A sequence stop needs a durable terminal state for work that has not crossed
-- the provider boundary. 0045 attempted to write `cancelled` without first
-- extending this CHECK, which rolled the entire stop transaction back.
alter table public.messages_outbound
  drop constraint if exists messages_outbound_status_check;
alter table public.messages_outbound
  add constraint messages_outbound_status_check
  check (status in (
    'composed', 'queued', 'blocked', 'dispatching', 'sent', 'failed', 'cancelled'
  ));

-- A provider receipt belongs to exactly one sequence step. Keep both sides of
-- the existing association explicit: the outbound-side FK survives step lookup
-- without trusting a caller, while the two unique indexes prevent receipt
-- replay even under concurrent bind attempts.
alter table public.messages_outbound
  add column if not exists sequence_step_id uuid,
  add column if not exists sequence_authority_bound boolean not null default false;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'messages_outbound_sequence_step_fkey'
       and conrelid = 'public.messages_outbound'::regclass
  ) then
    alter table public.messages_outbound
      add constraint messages_outbound_sequence_step_fkey
      foreign key (sequence_step_id)
      references public.outreach_sequence_steps(id)
      on delete set null;
  end if;
end;
$$;

-- Refuse the inverse half-link as well. This catches interrupted or manually
-- edited 0063 attempts where the outbound points at a step but the step does
-- not point back, or where any approved delivery authority has drifted.
do $$
declare
  invalid_outbound_bindings bigint;
begin
  select count(*) into invalid_outbound_bindings
    from public.messages_outbound outbound
    left join public.outreach_sequence_steps step on step.id = outbound.sequence_step_id
    left join public.outreach_sequences seq on seq.id = step.sequence_id
   where outbound.sequence_step_id is not null
     and (
       step.id is null
       or seq.id is null
       or step.queued_outbound_id is distinct from outbound.id
       or (
         outbound.sequence_authority_bound is false
         and (
           seq.status <> 'active'
           or step.status <> 'scheduled'
           or outbound.status not in ('composed', 'queued', 'dispatching', 'sent')
         )
       )
       or step.channel not in ('Email', 'WhatsApp')
       or outbound.workspace_id is distinct from seq.workspace_id
       or outbound.candidate_id is distinct from seq.candidate_id
       or outbound.campaign_id is distinct from seq.campaign_id
       or outbound.channel is distinct from step.channel
       or outbound.approval_message_id is distinct from step.message_id
       or outbound.body is distinct from step.body
       or coalesce(outbound.subject, '') <> ''
     );

  if invalid_outbound_bindings <> 0 then
    raise exception '0063 refuses % unsafe outbound sequence binding(s)', invalid_outbound_bindings
      using errcode = '23514',
            hint = 'Repair both sides of the sequence/outbound association before retrying the migration.';
  end if;
end;
$$;
-- The 0045 binder accepted any outbound UUID. Refuse to bless an existing
-- pointer unless every tenant, candidate, campaign, channel, approval, body,
-- subject, and recipient-scope field agrees. This is intentionally a hard
-- migration failure: silently choosing or quarantining a mismatched queued row
-- could let a worker send to the wrong person after upgrade.
do $$
declare
  invalid_bindings bigint;
begin
  select count(*) into invalid_bindings
    from public.outreach_sequence_steps step
    join public.outreach_sequences seq on seq.id = step.sequence_id
    left join public.messages_outbound outbound on outbound.id = step.queued_outbound_id
   where step.queued_outbound_id is not null
     and (
       outbound.id is null
       or (
         outbound.sequence_authority_bound is false
         and (
           seq.status <> 'active'
           or step.status <> 'scheduled'
           or outbound.status not in ('composed', 'queued', 'dispatching', 'sent')
         )
       )
       or step.channel not in ('Email', 'WhatsApp')
       or (outbound.sequence_step_id is not null
           and outbound.sequence_step_id is distinct from step.id)
       or outbound.workspace_id is distinct from seq.workspace_id
       or outbound.candidate_id is distinct from seq.candidate_id
       or outbound.campaign_id is distinct from seq.campaign_id
       or outbound.channel is distinct from step.channel
       or outbound.approval_message_id is distinct from step.message_id
       or outbound.body is distinct from step.body
       or coalesce(outbound.subject, '') <> ''
       or step.body_hash is distinct from encode(
         extensions.digest(E'\n' || step.body, 'sha256'), 'hex'
       )
       or step.scope_hash is distinct from encode(
         extensions.digest(
           seq.candidate_id || E'\n' || step.channel || E'\n' ||
           case step.channel
             when 'Email' then nullif(lower(btrim(coalesce(outbound.to_address, ''))), '')
             when 'WhatsApp' then public.normalize_whatsapp_e164(outbound.to_address)
             else null
           end,
           'sha256'
         ),
         'hex'
       )
       or (
         outbound.sequence_authority_bound is false
         and not exists (
           select 1
             from public.candidates candidate
            where candidate.workspace_id = seq.workspace_id
              and candidate.campaign_id = seq.campaign_id
              and candidate.id = seq.candidate_id
              and case step.channel
                when 'Email' then nullif(lower(btrim(coalesce(candidate.email, ''))), '')
                  is not distinct from nullif(lower(btrim(coalesce(outbound.to_address, ''))), '')
                when 'WhatsApp' then public.normalize_whatsapp_e164(candidate.phone)
                  is not distinct from public.normalize_whatsapp_e164(outbound.to_address)
                else false
              end
         )
       )
       or 1 <> (
         select count(*)
           from public.outreach_sequence_steps owner_step
          where owner_step.queued_outbound_id = step.queued_outbound_id
       )
     );

  if invalid_bindings <> 0 then
    raise exception '0063 refuses % unsafe legacy sequence outbound binding(s)', invalid_bindings
      using errcode = '23514',
            hint = 'Repair or clear the invalid 0045 queued_outbound_id pointers before retrying the migration.';
  end if;
end;
$$;

-- Preserve only the validated pre-0063 bindings before enforcing reciprocal
-- one-to-one ownership on both sides.
update public.messages_outbound outbound
   set sequence_step_id = step.id
  from public.outreach_sequence_steps step
 where step.queued_outbound_id = outbound.id
   and outbound.sequence_step_id is null;
update public.messages_outbound
   set sequence_authority_bound = true
 where sequence_step_id is not null
   and sequence_authority_bound is false;
alter table public.messages_outbound
  drop constraint if exists messages_outbound_sequence_authority_bound_check;
alter table public.messages_outbound
  add constraint messages_outbound_sequence_authority_bound_check
  check (sequence_step_id is null or sequence_authority_bound);
create unique index if not exists messages_outbound_sequence_step_uniq
  on public.messages_outbound(sequence_step_id)
  where sequence_step_id is not null;
create unique index if not exists outreach_sequence_steps_outbound_uniq
  on public.outreach_sequence_steps(queued_outbound_id)
  where queued_outbound_id is not null;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'outreach_sequence_steps_queued_outbound_fkey'
       and conrelid = 'public.outreach_sequence_steps'::regclass
  ) then
    alter table public.outreach_sequence_steps
      add constraint outreach_sequence_steps_queued_outbound_fkey
      foreign key (queued_outbound_id)
      references public.messages_outbound(id)
      on delete set null
      deferrable initially deferred;
  end if;
end;
$$;

-- Deployment authority is separate from tenant campaign controls. There is no
-- runtime grant or enable RPC in this phase; a protected release operation must
-- create/enable the row after source, canary, and production checks pass.
create table if not exists public.outreach_sequence_release_controls (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id),
  check ((enabled = false and enabled_at is null and enabled_by is null)
      or (enabled = true and enabled_at is not null and enabled_by is not null))
);
alter table public.outreach_sequence_release_controls enable row level security;
alter table public.outreach_sequence_release_controls force row level security;
revoke all on public.outreach_sequence_release_controls
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists outreach_sequence_release_controls_owner_access
  on public.outreach_sequence_release_controls;
create policy outreach_sequence_release_controls_owner_access
  on public.outreach_sequence_release_controls
  for all to postgres, supabase_admin using (true) with check (true);

-- 0033 hashed LinkedIn URLs after lower(trim(...)), so URL aliases could
-- produce different tombstones for the same profile. Mark every pre-0063
-- LinkedIn tombstone as unresolved legacy data before changing the default.
-- The lookup below fails closed for those workspaces because the plaintext
-- was correctly erased and cannot be reconstructed from its HMAC.
alter table public.candidate_erasure_suppression_tombstones
  add column if not exists normalization_version text;
update public.candidate_erasure_suppression_tombstones
   set normalization_version = case
     when identifier_kind = 'linkedin' then 'legacy_v1'
     else 'v1'
   end
 where normalization_version is null;
alter table public.candidate_erasure_suppression_tombstones
  alter column normalization_version set default 'legacy_v1',
  alter column normalization_version set not null;
alter table public.candidate_erasure_suppression_tombstones
  drop constraint if exists candidate_erasure_tombstones_normalization_version_check;
alter table public.candidate_erasure_suppression_tombstones
  add constraint candidate_erasure_tombstones_normalization_version_check
  check (normalization_version in ('legacy_v1', 'v1', 'canonical_v2'));

-- A LinkedIn approval is authority for exactly one manual sequence step. The
-- runtime-immutable snapshot prevents a completed or stopped sequence from
-- replaying the same human decision under a new sequence identifier. Runtime
-- roles have no table privileges; owner access remains available for governed
-- workspace deletion and future read access must use a bounded RPC.
create table if not exists public.outreach_sequence_manual_approval_consumptions (
  approval_id   uuid primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  sequence_id   uuid not null,
  step_id       uuid not null unique,
  message_id    text not null check (char_length(message_id) between 1 and 120),
  body_hash     text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  scope_hash    text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  approved_by   uuid not null,
  approved_at   timestamptz not null,
  consumed_at   timestamptz not null default now(),
  unique (workspace_id, message_id)
);

alter table public.outreach_sequence_manual_approval_consumptions enable row level security;
alter table public.outreach_sequence_manual_approval_consumptions force row level security;
revoke all on public.outreach_sequence_manual_approval_consumptions
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists outreach_sequence_manual_approval_consumptions_owner_access
  on public.outreach_sequence_manual_approval_consumptions;
create policy outreach_sequence_manual_approval_consumptions_owner_access
  on public.outreach_sequence_manual_approval_consumptions
  for all to postgres, supabase_admin using (true) with check (true);

-- The external LinkedIn action and the decision to advance the ladder are two
-- different facts. Record the named operator's assertion first so a kill,
-- revocation, or suppression change that races after the browser action cannot
-- erase history. The receipt contains identifiers and hashes, not message body
-- or profile URL, and deliberately survives sequence/candidate erasure.
create table if not exists public.outreach_sequence_manual_action_receipts (
  step_id       uuid primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  sequence_id   uuid not null,
  operator_id   uuid not null,
  approval_id   uuid not null,
  message_id    text not null check (char_length(message_id) between 1 and 120),
  body_hash     text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  scope_hash    text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  approved_by   uuid not null,
  approved_at   timestamptz not null,
  task_issued_at timestamptz not null,
  asserted_from_status text not null check (asserted_from_status in ('manual_task', 'cancelled')),
  sequence_status_at_assertion text not null,
  asserted_at   timestamptz not null default now(),
  unique (workspace_id, sequence_id, step_id)
);

-- Append-only evidence cannot truthfully promise ON DELETE CASCADE: the
-- mutation trigger would reject the cascade and make workspace deletion fail
-- with an unrelated trigger error. Retain it explicitly until a future
-- governed, receipt-backed workspace purge is approved.
alter table public.outreach_sequence_manual_action_receipts
  drop constraint if exists outreach_sequence_manual_action_receipts_workspace_id_fkey;
alter table public.outreach_sequence_manual_action_receipts
  add constraint outreach_sequence_manual_action_receipts_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete restrict;

alter table public.outreach_sequence_manual_action_receipts enable row level security;
alter table public.outreach_sequence_manual_action_receipts force row level security;
revoke all on public.outreach_sequence_manual_action_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists outreach_sequence_manual_action_receipts_owner_access
  on public.outreach_sequence_manual_action_receipts;
create policy outreach_sequence_manual_action_receipts_owner_access
  on public.outreach_sequence_manual_action_receipts
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.reject_sequence_manual_action_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'sequence manual action receipts are append-only'
    using errcode = '42501';
end;
$$;
revoke all on function public.reject_sequence_manual_action_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists outreach_sequence_manual_action_receipts_append_only
  on public.outreach_sequence_manual_action_receipts;
create trigger outreach_sequence_manual_action_receipts_append_only
  before update or delete on public.outreach_sequence_manual_action_receipts
  for each row execute function public.reject_sequence_manual_action_receipt_mutation();

-- ---------------------------------------------------------------------------
-- 2. Private helpers: canonical LinkedIn identity, safe tombstone lookup,
--    recipient eligibility, and a shared terminal-stop transaction.
--    Re-derives the canonical recipient identity for THIS step's channel and
--    checks suppression + erasure tombstones fresh (never trusts a value
--    resolved earlier). Missing/ambiguous identity is treated as blocked.
--    Not SECURITY DEFINER: it only ever runs nested inside an already
--    SECURITY DEFINER caller owned by postgres, and carries no grants of its
--    own (owner_only), matching the candidate_erasure_tombstone_exists
--    pattern it composes with.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_linkedin_profile_url(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
declare
  normalized text := lower(btrim(p_value));
  slug text;
begin
  normalized := regexp_replace(normalized, '^https?://', '');
  normalized := regexp_replace(normalized, '^www\.', '');
  if normalized !~ '^linkedin\.com/in/[^/?#]+/?([?#].*)?$' then
    return null;
  end if;
  slug := split_part(split_part(split_part(
    substr(normalized, char_length('linkedin.com/in/') + 1), '?', 1
  ), '#', 1), '/', 1);
  if char_length(slug) < 1 or char_length(slug) > 200 then
    return null;
  end if;
  return 'https://www.linkedin.com/in/' || slug;
end;
$$;
revoke all on function public.normalize_linkedin_profile_url(text)
  from public, anon, authenticated, service_role, authenticator;

-- Preserve the 0033 generic HMAC and lock-key contracts exactly. A dedicated
-- canonical helper is additive, so historical non-LinkedIn and exact legacy
-- LinkedIn checks do not silently change underneath existing callers.
create or replace function public.candidate_erasure_linkedin_canonical_hmac(
  p_workspace_id uuid,
  p_value text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  canonical text := public.normalize_linkedin_profile_url(p_value);
begin
  if canonical is null then return null; end if;
  return public.sourcing_authority_hmac(
    p_workspace_id,
    'candidate-erasure:linkedin:' || canonical
  );
end;
$$;
revoke all on function public.candidate_erasure_linkedin_canonical_hmac(uuid, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.candidate_erasure_tombstone_exists(
  p_workspace_id uuid,
  p_identifier_kind text,
  p_value text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.candidate_erasure_suppression_tombstones tombstone
     where tombstone.workspace_id = p_workspace_id
       and tombstone.identifier_kind = p_identifier_kind
       and (
         (
           p_identifier_kind = 'linkedin'
           and tombstone.normalization_version = 'canonical_v2'
           and tombstone.identifier_hmac = public.candidate_erasure_linkedin_canonical_hmac(
             p_workspace_id, p_value
           )
         )
         or (
           (p_identifier_kind <> 'linkedin'
             or tombstone.normalization_version <> 'canonical_v2')
           and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
             p_workspace_id, p_identifier_kind, p_value
           )
         )
       )
  );
$$;
revoke all on function public.candidate_erasure_tombstone_exists(uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;

-- 0037 linked a candidate by comparing only the legacy lower(trim(url)) HMAC.
-- New LinkedIn tombstones created by this migration use canonical_v2, so keep
-- the person layer on the same version-aware erasure authority. Without this
-- repair, a direct database re-entry could recreate a person/identity for a
-- canonically tombstoned LinkedIn profile.
create or replace function public.link_one_candidate(
  p_candidate public.candidates
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_key text;
  v_identity_count integer;
  v_person_id uuid;
begin
  if p_candidate.linkedin_url is not null
     and btrim(p_candidate.linkedin_url) ~* '^(https?://)?(www\.)?linkedin\.com/in/[^/?#]+/?(\?.*)?$' then
    v_key := lower(btrim(p_candidate.linkedin_url));
  end if;

  if v_key is null then
    update public.candidates candidate
       set person_id = null
     where candidate.workspace_id = p_candidate.workspace_id
       and candidate.campaign_id = p_candidate.campaign_id
       and candidate.id = p_candidate.id
       and candidate.person_id is not null;
    return null;
  end if;

  if exists (
    select 1
      from public.candidate_erasure_suppression_tombstones tombstone
     where tombstone.workspace_id = p_candidate.workspace_id
       and tombstone.identifier_kind = 'linkedin'
  ) and public.candidate_erasure_tombstone_exists(
    p_candidate.workspace_id,
    'linkedin',
    v_key
  ) then
    update public.candidates candidate
       set person_id = null
     where candidate.workspace_id = p_candidate.workspace_id
       and candidate.campaign_id = p_candidate.campaign_id
       and candidate.id = p_candidate.id
       and candidate.person_id is not null;
    return null;
  end if;

  select count(*)
    into v_identity_count
    from public.candidate_identities identity
   where identity.workspace_id = p_candidate.workspace_id
     and identity.kind = 'linkedin'
     and identity.value_normalized = v_key;

  if v_identity_count > 1 then
    raise warning 'ambiguous person identity for workspace %, linkedin %',
      p_candidate.workspace_id, v_key;
    update public.candidates candidate
       set person_id = null
     where candidate.workspace_id = p_candidate.workspace_id
       and candidate.campaign_id = p_candidate.campaign_id
       and candidate.id = p_candidate.id
       and candidate.person_id is not null;
    return null;
  end if;

  if v_identity_count = 1 then
    select identity.person_id
      into v_person_id
      from public.candidate_identities identity
     where identity.workspace_id = p_candidate.workspace_id
       and identity.kind = 'linkedin'
       and identity.value_normalized = v_key;
  end if;

  if v_person_id is null then
    insert into public.persons(workspace_id)
    values (p_candidate.workspace_id)
    returning person_id into v_person_id;
  end if;

  insert into public.candidate_identities(
    workspace_id, person_id, kind, value_normalized
  ) values (
    p_candidate.workspace_id, v_person_id, 'linkedin', v_key
  )
  on conflict (workspace_id, kind, value_normalized) do nothing;

  update public.candidates candidate
     set person_id = v_person_id
   where candidate.workspace_id = p_candidate.workspace_id
     and candidate.campaign_id = p_candidate.campaign_id
     and candidate.id = p_candidate.id
     and candidate.person_id is distinct from v_person_id;

  return v_person_id;
end;
$$;
revoke all on function public.link_one_candidate(public.candidates)
  from public, anon, authenticated, service_role, authenticator;

-- 0033's erasure transaction inserts tombstones before it removes the source
-- candidate from workspace_state. Upgrade that new LinkedIn row to canonical
-- v2 while the authorized plaintext is still present. If it is missing or
-- malformed, retain legacy_v1 and let the fail-closed gates below take over.
create or replace function public.canonicalize_candidate_erasure_linkedin_tombstone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  source_url text;
begin
  if new.identifier_kind <> 'linkedin' then
    new.normalization_version := 'v1';
    return new;
  end if;
  if new.normalization_version = 'canonical_v2' then
    return new;
  end if;

  select item.value->>'linkedinUrl' into source_url
    from public.candidate_erasure_requests request
    join public.workspace_state state on state.workspace_id = request.workspace_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(state.state->'candidates') = 'array'
        then state.state->'candidates' else '[]'::jsonb end
    ) item(value)
   where request.id = new.request_id
     and item.value->>'id' = request.candidate_id
     and item.value->>'campaignId' = request.campaign_id
   limit 1;

  if public.normalize_linkedin_profile_url(source_url) is null then
    new.normalization_version := 'legacy_v1';
  else
    new.identifier_hmac := public.candidate_erasure_linkedin_canonical_hmac(
      new.workspace_id, source_url
    );
    new.normalization_version := 'canonical_v2';
  end if;
  return new;
end;
$$;
revoke all on function public.canonicalize_candidate_erasure_linkedin_tombstone()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_tombstones_linkedin_canonicalize
  on public.candidate_erasure_suppression_tombstones;
create trigger candidate_erasure_tombstones_linkedin_canonicalize
  before insert on public.candidate_erasure_suppression_tombstones
  for each row execute function public.canonicalize_candidate_erasure_linkedin_tombstone();

-- A historical HMAC cannot be reverse-normalized. Preserve normal workspace
-- updates, but reject any new or changed LinkedIn candidate identity until an
-- operator resolves all legacy_v1 LinkedIn tombstones for that workspace.
create or replace function public.reject_legacy_linkedin_candidate_reimport()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.candidate_erasure_suppression_tombstones legacy
     where legacy.workspace_id = new.workspace_id
       and legacy.identifier_kind = 'linkedin'
       and legacy.normalization_version = 'legacy_v1'
  ) or jsonb_typeof(new.state->'candidates') <> 'array' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if exists (
      select 1 from jsonb_array_elements(new.state->'candidates') item(value)
       where coalesce(btrim(item.value->>'linkedinUrl'), '') <> ''
    ) then
      raise exception 'legacy LinkedIn erasure tombstone blocks candidate reimport'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if exists (
    select 1
      from jsonb_array_elements(new.state->'candidates') candidate(value)
     where coalesce(btrim(candidate.value->>'linkedinUrl'), '') <> ''
       and not exists (
         select 1
           from jsonb_array_elements(
             case when jsonb_typeof(old.state->'candidates') = 'array'
               then old.state->'candidates' else '[]'::jsonb end
           ) prior(value)
          where prior.value->>'id' = candidate.value->>'id'
            and prior.value->>'campaignId' = candidate.value->>'campaignId'
            and prior.value->>'linkedinUrl' is not distinct from candidate.value->>'linkedinUrl'
       )
  ) then
    raise exception 'legacy LinkedIn erasure tombstone blocks candidate reimport'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_legacy_linkedin_candidate_reimport()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists workspace_state_legacy_linkedin_reimport_guard
  on public.workspace_state;
create trigger workspace_state_legacy_linkedin_reimport_guard
  before insert or update of state on public.workspace_state
  for each row execute function public.reject_legacy_linkedin_candidate_reimport();

create or replace function public.outreach_sequence_tombstone_exists(
  p_workspace_id uuid,
  p_identifier_kind text,
  p_value text
) returns boolean
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  -- candidate_erasure_tombstone_exists computes an HMAC and therefore needs a
  -- workspace key. Do not invoke it when no tombstone could exist; this keeps
  -- an ordinary workspace without a historical erasure record fail-closed at
  -- the caller's recipient checks rather than raising from an unrelated key
  -- lookup.
  if not exists (
    select 1 from public.candidate_erasure_suppression_tombstones tombstone
     where tombstone.workspace_id = p_workspace_id
       and tombstone.identifier_kind = p_identifier_kind
  ) then
    return false;
  end if;
  -- The plaintext behind a pre-0063 LinkedIn HMAC was correctly erased, so it
  -- cannot be converted safely. Block LinkedIn sequence work in that workspace
  -- until an operator resolves the legacy tombstones from an authorized source.
  -- Keep this gate sequence-local: the general workspace reimport guard must not
  -- turn one unresolved historical tombstone into a workspace-wide write outage.
  if p_identifier_kind = 'linkedin' and exists (
    select 1
      from public.candidate_erasure_suppression_tombstones legacy
     where legacy.workspace_id = p_workspace_id
       and legacy.identifier_kind = 'linkedin'
       and legacy.normalization_version = 'legacy_v1'
  ) then
    return true;
  end if;
  -- An absent workspace HMAC key must not turn a confirmed tombstone into an
  -- exception that a caller could mistake for permission to continue. Treat
  -- the recipient as blocked until the security material is restored.
  if not exists (
    select 1 from public.sourcing_learning_secrets secret
     where secret.workspace_id = p_workspace_id
  ) then
    return true;
  end if;
  return public.candidate_erasure_tombstone_exists(
    p_workspace_id, p_identifier_kind, p_value
  );
end;
$$;
revoke all on function public.outreach_sequence_tombstone_exists(uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.outreach_sequence_recipient_blocked(
  p_seq public.outreach_sequences, p_step public.outreach_sequence_steps
) returns boolean
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  candidate public.candidates%rowtype;
  recipient text;
  domain text;
begin
  select * into candidate from public.candidates
   where workspace_id = p_seq.workspace_id
     and campaign_id = p_seq.campaign_id
     and id = p_seq.candidate_id;
  if not found then
    return true;
  end if;

  if public.outreach_sequence_tombstone_exists(p_seq.workspace_id, 'candidate_id', p_seq.candidate_id) then
    return true;
  end if;

  if p_step.channel = 'Email' then
    recipient := nullif(lower(btrim(coalesce(candidate.email, ''))), '');
    if recipient is null then return true; end if;
    domain := split_part(recipient, '@', 2);
    if public.outreach_sequence_tombstone_exists(p_seq.workspace_id, 'email', recipient) then
      return true;
    end if;
    return exists (
      select 1 from public.suppression_list s
       where s.workspace_id = p_seq.workspace_id
         and (s.expires_at is null or s.expires_at > now())
         and ((s.type = 'email' and lower(s.value) = recipient)
           or (s.type = 'domain' and lower(s.value) = domain))
    );
  elsif p_step.channel = 'WhatsApp' then
    recipient := public.normalize_whatsapp_e164(candidate.phone);
    if recipient is null then return true; end if;
    if public.outreach_sequence_tombstone_exists(p_seq.workspace_id, 'phone', recipient) then
      return true;
    end if;
    return exists (
      select 1 from public.suppression_list s
       where s.workspace_id = p_seq.workspace_id
         and s.type = 'phone' and s.value = recipient
         and (s.expires_at is null or s.expires_at > now())
    );
  elsif p_step.channel = 'LinkedIn' then
    recipient := public.normalize_linkedin_profile_url(candidate.linkedin_url);
    if recipient is null then return true; end if;
    if public.outreach_sequence_tombstone_exists(
         p_seq.workspace_id, 'linkedin', lower(btrim(candidate.linkedin_url))
       ) or public.outreach_sequence_tombstone_exists(
         p_seq.workspace_id, 'linkedin', recipient
       ) then
      return true;
    end if;
    return exists (
      select 1 from public.suppression_list s
       where s.workspace_id = p_seq.workspace_id
         and s.type = 'linkedin'
         and public.normalize_linkedin_profile_url(s.value) = recipient
         and (s.expires_at is null or s.expires_at > now())
    );
  end if;

  return true;
end;
$$;
revoke all on function public.outreach_sequence_recipient_blocked(public.outreach_sequences, public.outreach_sequence_steps)
  from public, anon, authenticated, service_role, authenticator;

-- Returns the approval scope hash for the recipient currently stored on the
-- candidate. A missing or malformed identity returns NULL, which is always a
-- mismatch at activation. This deliberately derives scope from durable
-- candidate state instead of trusting the draft-time scope hash.
create or replace function public.outreach_sequence_current_scope_hash(
  p_seq public.outreach_sequences, p_step public.outreach_sequence_steps
) returns text
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  candidate public.candidates%rowtype;
  recipient text;
begin
  select * into candidate
    from public.candidates
   where workspace_id = p_seq.workspace_id
     and campaign_id = p_seq.campaign_id
     and id = p_seq.candidate_id;
  if not found then
    return null;
  end if;

  if p_step.channel = 'Email' then
    recipient := nullif(lower(btrim(coalesce(candidate.email, ''))), '');
  elsif p_step.channel = 'WhatsApp' then
    recipient := public.normalize_whatsapp_e164(candidate.phone);
  elsif p_step.channel = 'LinkedIn' then
    recipient := public.normalize_linkedin_profile_url(candidate.linkedin_url);
  else
    return null;
  end if;

  if recipient is null then
    return null;
  end if;
  return encode(
    digest(p_seq.candidate_id || E'\n' || p_step.channel || E'\n' || recipient, 'sha256'),
    'hex'
  );
end;
$$;
revoke all on function public.outreach_sequence_current_scope_hash(public.outreach_sequences, public.outreach_sequence_steps)
  from public, anon, authenticated, service_role, authenticator;

-- Tenant controls and the protected release control must both permit work.
-- Row locks serialize a disable/kill operation against claim, enqueue, and
-- completion. Absence of the owner-only release row is deliberately false.
create or replace function public.outreach_sequence_execution_enabled(
  p_workspace_id uuid
) returns boolean
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  tenant_controls public.sourcing_loop_controls%rowtype;
  release_controls public.outreach_sequence_release_controls%rowtype;
begin
  select * into tenant_controls
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id
   for share;
  if not found
     or tenant_controls.kill_switch
     or not tenant_controls.sequences_enabled then
    return false;
  end if;

  select * into release_controls
    from public.outreach_sequence_release_controls
   where workspace_id = p_workspace_id
   for share;
  return found and release_controls.enabled;
end;
$$;
revoke all on function public.outreach_sequence_execution_enabled(uuid)
  from public, anon, authenticated, service_role, authenticator;

-- Existing channel enqueue RPCs create immediately dispatchable queued rows.
-- A transaction-local step request, set only by the bounded wrapper below,
-- makes the insert and sequence binding one database transaction. Generic
-- enqueue attempts that match a live scheduled sequence step fail before an
-- unbound queued row can become visible to a dispatcher.
--
-- The setting is an intent marker, not authority: a service-role session can
-- set a custom GUC too. This invoker-context guard runs before the privileged
-- validator and accepts a binding request only while a postgres-owned SECURITY
-- DEFINER enqueue function is executing the INSERT.
create or replace function public.enforce_sequence_outbound_insert_origin()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if nullif(current_setting('aria.sequence_step_id', true), '') is not null
     and current_user <> 'postgres' then
    raise exception 'sequence outbound insert requires bounded owner authority'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_sequence_outbound_insert_origin()
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.enforce_sequence_outbound_insert_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  requested_step_text text := nullif(current_setting('aria.sequence_step_id', true), '');
  requested_step_id uuid;
  target_sequence_id uuid;
  step public.outreach_sequence_steps%rowtype;
  seq public.outreach_sequences%rowtype;
  approval public.outreach_approvals%rowtype;
  outbound_recipient text;
  expected_scope_hash text;
  updated integer;
begin
  if new.sequence_authority_bound then
    raise exception 'sequence outbound authority marker requires atomic sequence enqueue'
      using errcode = '55000';
  end if;

  if requested_step_text is null then
    if new.sequence_step_id is not null then
      raise exception 'sequence_step_id requires atomic sequence enqueue'
        using errcode = '55000';
    end if;
    if new.status = 'queued' and exists (
      select 1
        from public.outreach_sequence_steps candidate_step
        join public.outreach_sequences candidate_sequence
          on candidate_sequence.id = candidate_step.sequence_id
       where candidate_sequence.workspace_id = new.workspace_id
         and candidate_sequence.candidate_id = new.candidate_id
         and (
           candidate_step.channel = 'WhatsApp'
           or candidate_sequence.campaign_id is not distinct from new.campaign_id
         )
         and candidate_sequence.status = 'active'
         and candidate_step.status = 'scheduled'
         and candidate_step.channel = new.channel
         and candidate_step.message_id = new.approval_message_id
         and candidate_step.body = new.body
    ) then
      raise exception 'sequence outbound requires atomic enqueue and binding'
        using errcode = '55000';
    end if;
    return new;
  end if;

  begin
    requested_step_id := requested_step_text::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid sequence step binding request' using errcode = '22023';
  end;
  if new.sequence_step_id is not null
     and new.sequence_step_id is distinct from requested_step_id then
    raise exception 'sequence step binding mismatch' using errcode = '55000';
  end if;

  select sequence_id into target_sequence_id
    from public.outreach_sequence_steps
   where id = requested_step_id;
  if not found then
    raise exception 'sequence step binding target not found' using errcode = '55000';
  end if;
  select * into seq from public.outreach_sequences
   where id = target_sequence_id
   for update;
  select * into step from public.outreach_sequence_steps
   where id = requested_step_id and sequence_id = seq.id
   for update;

  if seq.status <> 'active'
     or step.status <> 'scheduled'
     or step.channel not in ('Email', 'WhatsApp')
     or step.queued_outbound_id is not null
     or new.id is null
     or new.status <> 'queued'
     or new.delivery_attempt_id is not null
     or new.dispatching_at is not null
     or new.sent_at is not null
     or new.workspace_id is distinct from seq.workspace_id
     or new.candidate_id is distinct from seq.candidate_id
     or (step.channel = 'Email' and new.campaign_id is distinct from seq.campaign_id)
     or (step.channel = 'WhatsApp' and new.campaign_id is not null
         and new.campaign_id is distinct from seq.campaign_id)
     or new.channel is distinct from step.channel
     or new.approval_message_id is distinct from step.message_id
     or new.body is distinct from step.body
     or coalesce(new.subject, '') <> ''
     or step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
     or step.scope_hash is distinct from public.outreach_sequence_current_scope_hash(seq, step)
     or not public.outreach_sequence_execution_enabled(seq.workspace_id)
     or public.outreach_sequence_recipient_blocked(seq, step) then
    raise exception 'sequence outbound is not eligible for atomic binding'
      using errcode = '55000';
  end if;

  outbound_recipient := case step.channel
    when 'Email' then nullif(lower(btrim(coalesce(new.to_address, ''))), '')
    when 'WhatsApp' then public.normalize_whatsapp_e164(new.to_address)
    else null
  end;
  expected_scope_hash := case when outbound_recipient is null then null else encode(
    digest(seq.candidate_id || E'\n' || step.channel || E'\n' || outbound_recipient, 'sha256'),
    'hex'
  ) end;
  if expected_scope_hash is distinct from step.scope_hash then
    raise exception 'sequence outbound recipient scope mismatch' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(seq.workspace_id::text || ':' || step.message_id, 0)
  );
  select * into approval from public.outreach_approvals
   where workspace_id = seq.workspace_id and message_id = step.message_id
   for update;
  if not found
     or approval.body_hash is distinct from step.body_hash
     or approval.approval_scope_hash is distinct from step.scope_hash
     or approval.approval_source is distinct from 'human'
     or approval.revoked_at is not null then
    raise exception 'sequence outbound approval is not active' using errcode = '55000';
  end if;

  -- The mature WhatsApp enqueue function predates messages_outbound.campaign_id
  -- and therefore omits it. Fill the authority field only after every scope
  -- check above has succeeded.
  new.campaign_id := seq.campaign_id;
  new.sequence_step_id := step.id;
  new.sequence_authority_bound := true;
  update public.outreach_sequence_steps
     set queued_outbound_id = new.id
   where id = step.id and status = 'scheduled' and queued_outbound_id is null;
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'sequence outbound binding race lost' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_sequence_outbound_insert_binding()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists messages_outbound_sequence_binding
  on public.messages_outbound;
drop trigger if exists messages_outbound_sequence_binding_origin
  on public.messages_outbound;
drop trigger if exists messages_outbound_sequence_binding_validate
  on public.messages_outbound;
create trigger messages_outbound_sequence_binding_origin
  before insert on public.messages_outbound
  for each row execute function public.enforce_sequence_outbound_insert_origin();
create trigger messages_outbound_sequence_binding_validate
  before insert on public.messages_outbound
  for each row execute function public.enforce_sequence_outbound_insert_binding();

-- Keep update-time enforcement row-local so mature provider updates preserve
-- the parent -> steps -> outbound lock order. The only new binding path is the
-- owner-executed, content-validating legacy binder above; the GUC is an intent
-- marker, while current_user prevents a service-role caller from forging it.
create or replace function public.enforce_sequence_outbound_update_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  requested_step_text text := nullif(current_setting('aria.sequence_step_id', true), '');
begin
  if old.sequence_authority_bound and not new.sequence_authority_bound then
    raise exception 'sequence outbound authority marker is immutable'
      using errcode = '55000';
  end if;

  if old.sequence_step_id is distinct from new.sequence_step_id then
    if old.sequence_step_id is null and new.sequence_step_id is not null then
      if current_user <> 'postgres'
         or requested_step_text is null
         or requested_step_text <> new.sequence_step_id::text then
        raise exception 'sequence outbound update requires bounded binding authority'
          using errcode = '55000';
      end if;
      new.sequence_authority_bound := true;
    elsif old.sequence_step_id is not null and new.sequence_step_id is null then
      -- PostgreSQL's nested FK action is the only detach path. The historical
      -- marker remains true so the row can never fall through the generic claim.
      if current_user <> 'postgres' or pg_trigger_depth() <= 1 then
        raise exception 'sequence outbound binding is immutable'
          using errcode = '55000';
      end if;
      new.sequence_authority_bound := true;
    else
      raise exception 'sequence outbound binding is immutable'
        using errcode = '55000';
    end if;
  end if;

  if old.sequence_step_id is not null
     and new.sequence_step_id is not distinct from old.sequence_step_id
     and (
       new.workspace_id is distinct from old.workspace_id
       or new.candidate_id is distinct from old.candidate_id
       or new.campaign_id is distinct from old.campaign_id
       or new.spec_id is distinct from old.spec_id
       or new.run_id is distinct from old.run_id
       or new.seat_id is distinct from old.seat_id
       or new.owner_id is distinct from old.owner_id
       or new.conversation_id is distinct from old.conversation_id
       or new.channel is distinct from old.channel
       or new.to_address is distinct from old.to_address
       or new.type is distinct from old.type
       or new.subject is distinct from old.subject
       or new.body is distinct from old.body
       or new.approval_message_id is distinct from old.approval_message_id
       or new.template_id is distinct from old.template_id
       or new.template_parameters is distinct from old.template_parameters
       or new.dedupe_hash is distinct from old.dedupe_hash
       or new.content_hash is distinct from old.content_hash
     ) then
    raise exception 'sequence outbound delivery authority is immutable'
      using errcode = '55000';
  end if;

  if old.sequence_step_id is not null
     and new.sequence_step_id is not distinct from old.sequence_step_id then
    if new.status is distinct from old.status then
      -- The runtime dispatcher performs only these authority-reducing direct
      -- transitions as service_role: a pre-claim gate/error can block or fail a
      -- queued row, and a claimed WhatsApp dry-run can block a dispatching row.
      -- The evidence rules below require every attempt/provider field to remain
      -- unchanged. Provider acceptance/failure stays owner-only through the
      -- mature SECURITY DEFINER finalization RPCs.
      if current_user <> 'postgres'
         and not (
           current_user = 'service_role'
           and (
             (old.status = 'queued' and new.status in ('blocked', 'failed'))
             or (old.status = 'dispatching' and new.status = 'blocked')
           )
         ) then
        raise exception 'sequence outbound status requires bounded owner authority'
          using errcode = '55000';
      end if;
      if not (
        (old.status = 'composed' and new.status = 'cancelled')
        or (old.status = 'queued' and new.status in ('dispatching', 'blocked', 'failed', 'cancelled'))
        or (old.status = 'blocked' and new.status = 'cancelled')
        or (old.status = 'dispatching' and new.status in ('sent', 'failed', 'blocked'))
      ) then
        raise exception 'invalid sequence outbound status transition'
          using errcode = '55000';
      end if;
    end if;
    if (
         new.delivery_attempt_id is distinct from old.delivery_attempt_id
         or new.dispatching_at is distinct from old.dispatching_at
         or new.policy_snapshot is distinct from old.policy_snapshot
         or new.recipient_e164 is distinct from old.recipient_e164
       )
       and not (
         current_user = 'postgres'
         and old.status = 'queued'
         and new.status = 'dispatching'
       ) then
      raise exception 'sequence outbound claim evidence requires bounded owner authority'
        using errcode = '55000';
    end if;
    if (
         new.provider_message_id is distinct from old.provider_message_id
         or new.sent_at is distinct from old.sent_at
       )
       and not (
         current_user = 'postgres'
         and old.status = 'dispatching'
         and new.status = 'sent'
       ) then
      raise exception 'sequence outbound provider receipt requires bounded owner authority'
        using errcode = '55000';
    end if;
    if old.status = 'queued' and new.status = 'dispatching'
       and (new.delivery_attempt_id is null
         or new.dispatching_at is null
         or new.policy_snapshot is null) then
      raise exception 'sequence outbound dispatch evidence is incomplete'
        using errcode = '55000';
    end if;
    if old.status = 'dispatching' and new.status = 'sent'
       and (new.delivery_attempt_id is null
         or new.provider_message_id is null
         or new.sent_at is null) then
      raise exception 'sequence outbound provider receipt is incomplete'
        using errcode = '55000';
    end if;
  end if;

  if old.sequence_step_id is null
     and new.sequence_step_id is null
     and new.sequence_authority_bound
     and not old.sequence_authority_bound then
    raise exception 'sequence outbound authority marker requires a binding'
      using errcode = '55000';
  end if;
  if old.sequence_authority_bound
     and old.sequence_step_id is null
     and old.status in ('cancelled', 'failed', 'sent')
     and new.status in ('composed', 'queued', 'blocked', 'dispatching') then
    raise exception 'historical sequence outbound cannot be reactivated'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_sequence_outbound_update_authority()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists messages_outbound_sequence_update_authority
  on public.messages_outbound;
create trigger messages_outbound_sequence_update_authority
  before update on public.messages_outbound
  for each row execute function public.enforce_sequence_outbound_update_authority();

create or replace function public.outreach_sequence_stop_internal(
  p_sequence_id uuid,
  p_reason text
) returns json
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  new_status text;
  updated int;
  in_flight int;
begin
  new_status := case p_reason
    when 'reply' then 'stopped_reply' when 'optout' then 'stopped_optout'
    when 'manual' then 'stopped_manual' when 'erasure' then 'stopped_erasure'
    when 'campaign' then 'stopped_campaign' else 'stopped_manual' end;

  -- One lock order everywhere: parent sequence, ordered child steps, then
  -- outbound/approval rows. This prevents a later-step worker and a terminal
  -- stop from each holding the row the other needs.
  perform 1 from public.outreach_sequences
   where id = p_sequence_id
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  perform 1 from public.outreach_sequence_steps
   where sequence_id = p_sequence_id
   order by ordinal
   for update;
  update public.outreach_sequences set status = new_status, updated_at = now()
   where id = p_sequence_id and status in ('active', 'paused_ambiguous', 'pending_approval');
  get diagnostics updated = row_count;
  if updated = 0 then return json_build_object('ok', false, 'reason', 'not-stoppable'); end if;

  update public.messages_outbound mo
     set status = 'cancelled'
    from public.outreach_sequence_steps s
   where s.sequence_id = p_sequence_id
     and s.queued_outbound_id = mo.id
     and s.status = 'scheduled'
     and mo.status in ('composed', 'queued', 'blocked');
  update public.outreach_sequence_steps
     set status = 'cancelled', verification_source = null
   where sequence_id = p_sequence_id
     and (
       status in ('waiting', 'due', 'manual_task')
       or (
         status = 'scheduled'
         and (
           queued_outbound_id is null
           or not exists (
             select 1 from public.messages_outbound mo
              where mo.id = outreach_sequence_steps.queued_outbound_id
                and mo.status in ('dispatching', 'sent')
           )
         )
       )
     );
  select count(*) into in_flight
    from public.outreach_sequence_steps s
    join public.messages_outbound mo on mo.id = s.queued_outbound_id
   where s.sequence_id = p_sequence_id
     and s.status = 'scheduled'
     and mo.status in ('dispatching', 'sent');
  return json_build_object('ok', true, 'status', new_status, 'in_flight', in_flight);
end;
$$;
revoke all on function public.outreach_sequence_stop_internal(uuid, text)
  from public, anon, authenticated, service_role, authenticator;

-- Candidate erasure must serialize with claim/stop and cancel every outbound
-- that has not crossed the provider boundary before the 0045 cleanup trigger
-- deletes the sequence. FK-driven pointer clearing retains the historical
-- marker, and the later 0033 scrub may still redact candidate content.
create or replace function public.cleanup_erased_candidate_sequences()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform 1
    from public.outreach_sequences seq
   where seq.workspace_id = new.workspace_id
     and seq.candidate_id = new.candidate_id
   order by seq.id
   for update;
  perform 1
    from public.outreach_sequence_steps step
    join public.outreach_sequences seq on seq.id = step.sequence_id
   where seq.workspace_id = new.workspace_id
     and seq.candidate_id = new.candidate_id
   order by seq.id, step.ordinal
   for update of step;
  update public.messages_outbound outbound
     set status = 'cancelled'
    from public.outreach_sequence_steps step
    join public.outreach_sequences seq on seq.id = step.sequence_id
   where seq.workspace_id = new.workspace_id
     and seq.candidate_id = new.candidate_id
     and step.queued_outbound_id = outbound.id
     and outbound.status in ('composed', 'queued', 'blocked');
  delete from public.outreach_sequences
   where workspace_id = new.workspace_id
     and candidate_id = new.candidate_id;
  return null;
end;
$$;
revoke all on function public.cleanup_erased_candidate_sequences()
  from public, anon, authenticated, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- 3. activate_outreach_sequence — adds the recipient-resolution + tombstone
--    + suppression gate (Codex Terra Phase 0: "checked at activation").
--    Same signature; behavior-only repair.
-- ---------------------------------------------------------------------------
create or replace function public.activate_outreach_sequence(p_sequence_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  seq public.outreach_sequences%rowtype;
  unapproved int;
  ineligible int;
  updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  select * into seq from public.outreach_sequences where id = p_sequence_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  perform 1 from public.outreach_sequence_steps
   where sequence_id = p_sequence_id
   order by ordinal
   for update;
  if seq.status <> 'pending_approval' then return json_build_object('ok', false, 'reason', 'not-pending'); end if;

  if not public.outreach_sequence_execution_enabled(seq.workspace_id) then
    return json_build_object('ok', false, 'reason', 'sequences_disabled');
  end if;

  -- Check only identities used by actual steps. A suppressed LinkedIn profile
  -- must not disable an Email-only sequence, while a missing identity for an
  -- actual step always blocks activation.
  select count(*) into ineligible
    from public.outreach_sequence_steps step
   where step.sequence_id = seq.id
     and step.ordinal < seq.max_touches
     and public.outreach_sequence_recipient_blocked(seq, step);
  if ineligible > 0 then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object('ok', false, 'reason', 'recipient-ineligible', 'count', ineligible);
  end if;

  -- Serialize human approval mutation against the exact rows this activation
  -- will consume. Revocation/re-approval cannot slip between validation and
  -- the immutable LinkedIn consumption snapshot.
  perform 1
    from public.outreach_approvals approval
    join public.outreach_sequence_steps step
      on step.sequence_id = seq.id
     and step.ordinal < seq.max_touches
     and step.message_id = approval.message_id
   where approval.workspace_id = seq.workspace_id
   order by approval.id
   for update of approval;

  select count(*) into unapproved
    from public.outreach_sequence_steps s
    where s.sequence_id = p_sequence_id
      and s.ordinal < seq.max_touches
      and not exists (
        select 1 from public.outreach_approvals a
        where a.workspace_id = seq.workspace_id
          and a.message_id = s.message_id
          and a.body_hash = s.body_hash
          and a.approval_scope_hash = s.scope_hash
          and a.approval_source = 'human'
          and a.revoked_at is null
          and s.body_hash = encode(digest(E'\n' || s.body, 'sha256'), 'hex')
          and s.scope_hash = public.outreach_sequence_current_scope_hash(seq, s));
  if unapproved > 0 then
    return json_build_object('ok', false, 'reason', 'steps-unapproved', 'missing', unapproved);
  end if;

  -- LinkedIn has no provider/outbound claim. Consume each human approval once
  -- at activation so it cannot authorize another manual sequence later.
  begin
    insert into public.outreach_sequence_manual_approval_consumptions(
      approval_id, workspace_id, sequence_id, step_id, message_id,
      body_hash, scope_hash, approved_by, approved_at
    )
    select approval.id, seq.workspace_id, seq.id, step.id, step.message_id,
           step.body_hash, step.scope_hash, approval.approved_by, approval.approved_at
      from public.outreach_sequence_steps step
      join public.outreach_approvals approval
        on approval.workspace_id = seq.workspace_id
       and approval.message_id = step.message_id
       and approval.body_hash = step.body_hash
       and approval.approval_scope_hash = step.scope_hash
       and approval.approval_source = 'human'
       and approval.revoked_at is null
     where step.sequence_id = seq.id
       and step.ordinal < seq.max_touches
       and step.channel = 'LinkedIn';
  exception when unique_violation then
    return json_build_object('ok', false, 'reason', 'approval-already-consumed');
  end;

  update public.outreach_sequences set status = 'active', updated_at = now()
   where id = p_sequence_id and status = 'pending_approval';
  get diagnostics updated = row_count;
  if updated = 0 then return json_build_object('ok', false, 'reason', 'race-lost'); end if;

  update public.outreach_sequence_steps
     set status = 'cancelled'
   where sequence_id = p_sequence_id
     and ordinal >= seq.max_touches
     and status = 'waiting';
  update public.outreach_sequence_steps
     set status = 'due', due_at = now()
   where sequence_id = p_sequence_id and ordinal = 0 and status = 'waiting';
  return json_build_object('ok', true, 'status', 'active');
end; $$;
revoke all on function public.activate_outreach_sequence(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.activate_outreach_sequence(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. stop_outreach_sequence — a terminal stop must also cancel an unclaimed
--    manual_task (LinkedIn) step, not just waiting/due/scheduled ones.
-- ---------------------------------------------------------------------------
create or replace function public.stop_outreach_sequence(p_sequence_id uuid, p_reason text) returns json
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  return public.outreach_sequence_stop_internal(p_sequence_id, p_reason);
end; $$;
revoke all on function public.stop_outreach_sequence(uuid, text) from public, anon, authenticated, authenticator;
grant execute on function public.stop_outreach_sequence(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. claim_sequence_step_for_schedule — the repair. Resolves the canonical
--    per-channel recipient identity from public.candidates, checks it
--    against suppression_list(type, value) (never a nonexistent
--    suppression_list.candidate_id column) and erasure tombstones, and
--    sends LinkedIn to manual_task instead of scheduled.
-- ---------------------------------------------------------------------------
create or replace function public.claim_sequence_step_for_schedule(p_step_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  step public.outreach_sequence_steps%rowtype; seq public.outreach_sequences%rowtype;
  candidate public.candidates%rowtype;
  approval_row public.outreach_approvals%rowtype;
  target_sequence_id uuid;
  recipient text; domain text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;

  select sequence_id into target_sequence_id
    from public.outreach_sequence_steps
   where id = p_step_id;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  select * into seq from public.outreach_sequences where id = target_sequence_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'sequence-not-found'); end if;
  select * into step from public.outreach_sequence_steps
   where id = p_step_id and sequence_id = seq.id
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if step.status <> 'due' or step.due_at is null or step.due_at > now() then
    return json_build_object('ok', false, 'reason', 'not-due');
  end if;

  if seq.status <> 'active' then return json_build_object('ok', false, 'reason', 'sequence-not-active'); end if;

  if not public.outreach_sequence_execution_enabled(seq.workspace_id) then
    perform public.outreach_sequence_stop_internal(seq.id, 'campaign');
    return json_build_object('ok', false, 'reason', 'sequences_disabled');
  end if;

  -- Serialize with record/revoke_outreach_approval. Once this returns a task,
  -- no revocation could have committed between approval validation and the
  -- due -> manual_task/scheduled transition.
  perform pg_advisory_xact_lock(
    hashtextextended(seq.workspace_id::text || ':' || step.message_id, 0)
  );
  select * into approval_row
    from public.outreach_approvals a
   where a.workspace_id = seq.workspace_id
     and a.message_id = step.message_id
   for update;
  if not found
     or approval_row.body_hash is distinct from step.body_hash
     or approval_row.approval_scope_hash is distinct from step.scope_hash
     or approval_row.approval_source is distinct from 'human'
     or approval_row.revoked_at is not null then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object('ok', false, 'reason', 'approval-revoked');
  end if;

  -- Canonical channel-bound recipient identity, resolved fresh from the
  -- durable candidate record (never trusted from a caller-supplied address).
  select * into candidate from public.candidates
   where workspace_id = seq.workspace_id and campaign_id = seq.campaign_id and id = seq.candidate_id;
  if not found then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object('ok', false, 'reason', 'recipient-identity-missing');
  end if;

  if public.outreach_sequence_tombstone_exists(seq.workspace_id, 'candidate_id', seq.candidate_id) then
    perform public.outreach_sequence_stop_internal(seq.id, 'erasure');
    return json_build_object('ok', false, 'reason', 'erased');
  end if;

  if step.channel = 'Email' then
    recipient := nullif(lower(btrim(coalesce(candidate.email, ''))), '');
    if recipient is null then
      perform public.outreach_sequence_stop_internal(seq.id, 'manual');
      return json_build_object('ok', false, 'reason', 'recipient-identity-missing');
    end if;
    domain := split_part(recipient, '@', 2);
    if public.outreach_sequence_tombstone_exists(seq.workspace_id, 'email', recipient) then
      perform public.outreach_sequence_stop_internal(seq.id, 'erasure');
      return json_build_object('ok', false, 'reason', 'erased');
    end if;
    if exists (
      select 1 from public.suppression_list s
       where s.workspace_id = seq.workspace_id
         and (s.expires_at is null or s.expires_at > now())
         and ((s.type = 'email' and lower(s.value) = recipient)
           or (s.type = 'domain' and lower(s.value) = domain))
    ) then
      perform public.outreach_sequence_stop_internal(seq.id, 'optout');
      return json_build_object('ok', false, 'reason', 'suppressed');
    end if;
    if step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
       or step.scope_hash is distinct from encode(
         digest(seq.candidate_id || E'\n' || step.channel || E'\n' || recipient, 'sha256'), 'hex'
       ) then
      perform public.outreach_sequence_stop_internal(seq.id, 'manual');
      return json_build_object('ok', false, 'reason', 'approval-content-or-scope-mismatch');
    end if;

    update public.outreach_sequence_steps
       set status = 'scheduled', scheduled_at = now()
     where id = p_step_id;

    return json_build_object(
      'ok', true, 'reason', 'scheduled',
      'step_id', step.id, 'sequence_id', seq.id, 'ordinal', step.ordinal,
      'channel', step.channel, 'message_id', step.message_id,
      'candidate_id', seq.candidate_id, 'workspace_id', seq.workspace_id,
      'body', step.body, 'recipient', recipient
    );

  elsif step.channel = 'WhatsApp' then
    recipient := public.normalize_whatsapp_e164(candidate.phone);
    if recipient is null then
      perform public.outreach_sequence_stop_internal(seq.id, 'manual');
      return json_build_object('ok', false, 'reason', 'recipient-identity-missing');
    end if;
    if public.outreach_sequence_tombstone_exists(seq.workspace_id, 'phone', recipient) then
      perform public.outreach_sequence_stop_internal(seq.id, 'erasure');
      return json_build_object('ok', false, 'reason', 'erased');
    end if;
    if exists (
      select 1 from public.suppression_list s
       where s.workspace_id = seq.workspace_id
         and s.type = 'phone' and s.value = recipient
         and (s.expires_at is null or s.expires_at > now())
    ) then
      perform public.outreach_sequence_stop_internal(seq.id, 'optout');
      return json_build_object('ok', false, 'reason', 'suppressed');
    end if;
    if step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
       or step.scope_hash is distinct from encode(
         digest(seq.candidate_id || E'\n' || step.channel || E'\n' || recipient, 'sha256'), 'hex'
       ) then
      perform public.outreach_sequence_stop_internal(seq.id, 'manual');
      return json_build_object('ok', false, 'reason', 'approval-content-or-scope-mismatch');
    end if;

    update public.outreach_sequence_steps
       set status = 'scheduled', scheduled_at = now()
     where id = p_step_id;

    return json_build_object(
      'ok', true, 'reason', 'scheduled',
      'step_id', step.id, 'sequence_id', seq.id, 'ordinal', step.ordinal,
      'channel', step.channel, 'message_id', step.message_id,
      'candidate_id', seq.candidate_id, 'workspace_id', seq.workspace_id,
      'body', step.body, 'recipient', recipient
    );

  elsif step.channel = 'LinkedIn' then
    recipient := public.normalize_linkedin_profile_url(candidate.linkedin_url);
    if recipient is null then
      perform public.outreach_sequence_stop_internal(seq.id, 'manual');
      return json_build_object('ok', false, 'reason', 'recipient-identity-missing');
    end if;
    if public.outreach_sequence_tombstone_exists(
         seq.workspace_id, 'linkedin', lower(btrim(candidate.linkedin_url))
       ) or public.outreach_sequence_tombstone_exists(
         seq.workspace_id, 'linkedin', recipient
       ) then
      perform public.outreach_sequence_stop_internal(seq.id, 'erasure');
      return json_build_object('ok', false, 'reason', 'erased');
    end if;
    if exists (
      select 1 from public.suppression_list s
       where s.workspace_id = seq.workspace_id
         and s.type = 'linkedin'
         and public.normalize_linkedin_profile_url(s.value) = recipient
         and (s.expires_at is null or s.expires_at > now())
    ) then
      perform public.outreach_sequence_stop_internal(seq.id, 'optout');
      return json_build_object('ok', false, 'reason', 'suppressed');
    end if;
    if step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
       or step.scope_hash is distinct from encode(
         digest(seq.candidate_id || E'\n' || step.channel || E'\n' || recipient, 'sha256'), 'hex'
       ) then
      perform public.outreach_sequence_stop_internal(seq.id, 'manual');
      return json_build_object('ok', false, 'reason', 'approval-content-or-scope-mismatch');
    end if;
    if not exists (
      select 1
        from public.outreach_sequence_manual_approval_consumptions consumption
        join public.outreach_approvals approval on approval.id = consumption.approval_id
       where consumption.workspace_id = seq.workspace_id
         and consumption.sequence_id = seq.id
         and consumption.step_id = step.id
         and consumption.message_id = step.message_id
         and consumption.body_hash = step.body_hash
         and consumption.scope_hash = step.scope_hash
         and consumption.approved_by = approval.approved_by
         and consumption.approved_at = approval.approved_at
         and approval.workspace_id = seq.workspace_id
         and approval.message_id = step.message_id
         and approval.body_hash = step.body_hash
         and approval.approval_scope_hash = step.scope_hash
         and approval.approval_source = 'human'
         and approval.revoked_at is null
    ) then
      perform public.outreach_sequence_stop_internal(seq.id, 'manual');
      return json_build_object('ok', false, 'reason', 'approval-not-consumed');
    end if;

    -- LinkedIn NEVER schedules and NEVER gets an outbound row
    -- (bind_sequence_step_outbound requires status = 'scheduled', so a
    -- manual_task step is structurally unbindable). A named human performs
    -- the action in LinkedIn and records an operator assertion later via
    -- complete_sequence_manual_task; this is never provider-confirmed.
    update public.outreach_sequence_steps
       set status = 'manual_task', scheduled_at = now(), verification_source = null
     where id = p_step_id;

    return json_build_object(
      'ok', true, 'reason', 'manual_task', 'completion_mode', 'operator_assertion',
      'step_id', step.id, 'sequence_id', seq.id, 'ordinal', step.ordinal,
      'channel', step.channel, 'message_id', step.message_id,
      'candidate_id', seq.candidate_id, 'workspace_id', seq.workspace_id,
      'body', step.body, 'recipient', recipient
    );
  end if;

  return json_build_object('ok', false, 'reason', 'unsupported-channel');
end; $$;
revoke all on function public.claim_sequence_step_for_schedule(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.claim_sequence_step_for_schedule(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. bind_sequence_step_outbound — bind only the matching tenant, candidate,
--    and channel. The 0045 version accepted any UUID, which let a durable send
--    receipt for a different outbound row advance this sequence.
-- ---------------------------------------------------------------------------
create or replace function public.bind_sequence_step_outbound(p_step_id uuid, p_outbound_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  step public.outreach_sequence_steps%rowtype;
  seq public.outreach_sequences%rowtype;
  outbound public.messages_outbound%rowtype;
  outbound_recipient text;
  target_sequence_id uuid;
  updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_outbound_id is null then return json_build_object('ok', false, 'reason', 'outbound-required'); end if;

  select sequence_id into target_sequence_id
    from public.outreach_sequence_steps
   where id = p_step_id;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  select * into seq from public.outreach_sequences where id = target_sequence_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'sequence-not-found'); end if;
  select * into step from public.outreach_sequence_steps
   where id = p_step_id and sequence_id = seq.id
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if step.queued_outbound_id is not null then
    if step.queued_outbound_id <> p_outbound_id then
      return json_build_object('ok', false, 'reason', 'already-bound-other');
    end if;
    select * into outbound
      from public.messages_outbound
     where id = p_outbound_id
     for update;
    outbound_recipient := case step.channel
      when 'Email' then nullif(lower(btrim(coalesce(outbound.to_address, ''))), '')
      when 'WhatsApp' then public.normalize_whatsapp_e164(outbound.to_address)
      else null
    end;
    if found
       and seq.status = 'active'
       and step.status = 'scheduled'
       and step.channel in ('Email', 'WhatsApp')
       and outbound.sequence_step_id = step.id
       and outbound.status in ('composed', 'queued', 'dispatching', 'sent')
       and outbound.workspace_id is not distinct from seq.workspace_id
       and outbound.candidate_id is not distinct from seq.candidate_id
       and outbound.campaign_id is not distinct from seq.campaign_id
       and outbound.channel is not distinct from step.channel
       and outbound.approval_message_id is not distinct from step.message_id
       and outbound.body is not distinct from step.body
       and coalesce(outbound.subject, '') = ''
       and outbound_recipient is not null
       and step.body_hash is not distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
       and step.scope_hash is not distinct from encode(
         digest(seq.candidate_id || E'\n' || step.channel || E'\n' || outbound_recipient, 'sha256'), 'hex'
       ) then
      return json_build_object(
        'ok', true, 'reason', 'already-bound', 'status', outbound.status,
        'id', outbound.id, 'step_id', step.id, 'sequence_id', seq.id
      );
    end if;
    return json_build_object('ok', false, 'reason', 'bound-terminal-or-inconsistent');
  end if;
  if step.status <> 'scheduled' or step.channel not in ('Email', 'WhatsApp') then
    return json_build_object('ok', false, 'reason', 'not-bindable');
  end if;
  if seq.status <> 'active' then return json_build_object('ok', false, 'reason', 'sequence-not-active'); end if;
  select * into outbound from public.messages_outbound where id = p_outbound_id for update;
  outbound_recipient := case step.channel
    when 'Email' then nullif(lower(btrim(coalesce(outbound.to_address, ''))), '')
    when 'WhatsApp' then public.normalize_whatsapp_e164(outbound.to_address)
    else null
  end;
  if not found
     or outbound.workspace_id is distinct from seq.workspace_id
     or outbound.candidate_id is distinct from seq.candidate_id
     or outbound.campaign_id is distinct from seq.campaign_id
     or outbound.channel is distinct from step.channel
     or outbound.approval_message_id is distinct from step.message_id
     or outbound.body is distinct from step.body
     or coalesce(outbound.subject, '') <> ''
     or step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
     or step.scope_hash is distinct from public.outreach_sequence_current_scope_hash(seq, step)
     or outbound_recipient is null
     or step.scope_hash is distinct from encode(
       digest(seq.candidate_id || E'\n' || step.channel || E'\n' || outbound_recipient, 'sha256'), 'hex'
     ) then
    return json_build_object('ok', false, 'reason', 'outbound-mismatch');
  end if;

  if outbound.sequence_step_id is not null
     or exists (
       select 1 from public.outreach_sequence_steps existing_step
        where existing_step.queued_outbound_id = p_outbound_id
          and existing_step.id <> step.id
     ) then
    return json_build_object('ok', false, 'reason', 'outbound-already-bound');
  end if;
  -- Queued/dispatching/sent rows have crossed the dispatcher visibility
  -- boundary. They may only be sequence-owned when the insert trigger bound
  -- them atomically in the same transaction. This legacy binder accepts only
  -- non-dispatchable composed rows.
  if outbound.status <> 'composed'
     or outbound.delivery_attempt_id is not null
     or outbound.dispatching_at is not null
     or outbound.sent_at is not null then
    return json_build_object('ok', false, 'reason', 'outbound-not-bindable');
  end if;

  begin
    perform set_config('aria.sequence_step_id', step.id::text, true);
    update public.messages_outbound
       set sequence_step_id = step.id
     where id = outbound.id
       and status = 'composed'
       and sequence_step_id is null;
    get diagnostics updated = row_count;
    if updated <> 1 then
      raise exception 'outbound binding race lost' using errcode = '40001';
    end if;
    perform set_config('aria.sequence_step_id', '', true);

    update public.outreach_sequence_steps
       set queued_outbound_id = p_outbound_id
     where id = step.id and status = 'scheduled' and queued_outbound_id is null;
    get diagnostics updated = row_count;
    if updated <> 1 then
      raise exception 'sequence step binding race lost' using errcode = '40001';
    end if;
  exception when unique_violation then
    perform set_config('aria.sequence_step_id', '', true);
    return json_build_object('ok', false, 'reason', 'outbound-already-bound');
  end;
  return json_build_object('ok', true, 'reason', 'bound');
end;
$$;
revoke all on function public.bind_sequence_step_outbound(uuid, uuid) from public, anon, authenticated, authenticator;
grant execute on function public.bind_sequence_step_outbound(uuid, uuid) to service_role;

-- The only dispatchable enqueue path for an Email/WhatsApp sequence step.
-- Existing channel enqueue RPCs retain their mature approval/sender/dedupe
-- policies; the insert trigger binds their queued row before the transaction
-- commits, so a dispatcher and a terminal stop can never observe an orphan.
create or replace function public.enqueue_and_bind_sequence_step_outbound(
  p_step_id uuid,
  p_seat_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_workspace_id uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  scoped_sequence_id uuid;
  seq public.outreach_sequences%rowtype;
  step public.outreach_sequence_steps%rowtype;
  candidate public.candidates%rowtype;
  approval public.outreach_approvals%rowtype;
  bound_outbound public.messages_outbound%rowtype;
  recipient text;
  enqueue_result json;
  outbound_id uuid;
begin
  if actor_id is null or actor_workspace_id is null then
    return json_build_object('ok', false, 'reason', 'not-authenticated');
  end if;
  if role_name not in ('admin', 'member') then
    return json_build_object('ok', false, 'reason', 'insufficient-permissions');
  end if;

  select sequence_step.sequence_id into scoped_sequence_id
    from public.outreach_sequence_steps sequence_step
    join public.outreach_sequences sequence_row on sequence_row.id = sequence_step.sequence_id
   where sequence_step.id = p_step_id
     and sequence_row.workspace_id = actor_workspace_id;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;

  select * into seq from public.outreach_sequences
   where id = scoped_sequence_id and workspace_id = actor_workspace_id
   for update;
  select * into step from public.outreach_sequence_steps
   where id = p_step_id and sequence_id = seq.id
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if step.queued_outbound_id is not null then
    select * into bound_outbound
      from public.messages_outbound
     where id = step.queued_outbound_id
     for update;
    if found
       and seq.status = 'active'
       and step.status = 'scheduled'
       and step.channel in ('Email', 'WhatsApp')
       and bound_outbound.sequence_step_id = step.id
       and bound_outbound.status in ('queued', 'dispatching', 'sent')
       and bound_outbound.workspace_id is not distinct from seq.workspace_id
       and bound_outbound.candidate_id is not distinct from seq.candidate_id
       and bound_outbound.campaign_id is not distinct from seq.campaign_id
       and bound_outbound.channel is not distinct from step.channel
       and bound_outbound.approval_message_id is not distinct from step.message_id
       and bound_outbound.body is not distinct from step.body
       and coalesce(bound_outbound.subject, '') = '' then
      return json_build_object(
        'ok', true, 'reason', 'already-bound', 'status', bound_outbound.status,
        'id', bound_outbound.id, 'step_id', step.id, 'sequence_id', seq.id
      );
    end if;
    return json_build_object('ok', false, 'reason', 'bound-terminal-or-inconsistent');
  end if;
  if seq.status <> 'active' or step.status <> 'scheduled'
     or step.channel not in ('Email', 'WhatsApp') then
    return json_build_object('ok', false, 'reason', 'not-bindable');
  end if;
  if not public.outreach_sequence_execution_enabled(seq.workspace_id) then
    perform public.outreach_sequence_stop_internal(seq.id, 'campaign');
    return json_build_object('ok', false, 'reason', 'sequences_disabled');
  end if;
  if step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
     or step.scope_hash is distinct from public.outreach_sequence_current_scope_hash(seq, step) then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object('ok', false, 'reason', 'approval-content-or-scope-mismatch');
  end if;
  if public.outreach_sequence_recipient_blocked(seq, step) then
    perform public.outreach_sequence_stop_internal(seq.id, 'optout');
    return json_build_object('ok', false, 'reason', 'recipient-ineligible');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(seq.workspace_id::text || ':' || step.message_id, 0)
  );
  select * into approval from public.outreach_approvals
   where workspace_id = seq.workspace_id and message_id = step.message_id
   for update;
  if not found
     or approval.body_hash is distinct from step.body_hash
     or approval.approval_scope_hash is distinct from step.scope_hash
     or approval.approval_source is distinct from 'human'
     or approval.revoked_at is not null then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object('ok', false, 'reason', 'approval-revoked');
  end if;

  select * into candidate from public.candidates
   where workspace_id = seq.workspace_id
     and campaign_id = seq.campaign_id
     and id = seq.candidate_id;
  if not found then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object('ok', false, 'reason', 'recipient-identity-missing');
  end if;
  recipient := case step.channel
    when 'Email' then nullif(lower(btrim(coalesce(candidate.email, ''))), '')
    when 'WhatsApp' then public.normalize_whatsapp_e164(candidate.phone)
    else null
  end;
  if recipient is null then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object('ok', false, 'reason', 'recipient-identity-missing');
  end if;

  perform set_config('aria.sequence_step_id', step.id::text, true);
  if step.channel = 'Email' then
    enqueue_result := public.enqueue_email_outbound(
      step.message_id, seq.candidate_id, seq.campaign_id, p_seat_id,
      recipient, '', step.body
    );
  else
    enqueue_result := public.enqueue_whatsapp_outbound(
      step.message_id, seq.candidate_id, seq.campaign_id, p_seat_id,
      recipient, 'candidate_reply', '', step.body, null, '[]'::jsonb
    );
  end if;
  perform set_config('aria.sequence_step_id', '', true);

  if coalesce((enqueue_result->>'ok')::boolean, false) = false then
    return enqueue_result;
  end if;
  begin
    outbound_id := (enqueue_result->>'id')::uuid;
  exception when invalid_text_representation then
    raise exception 'channel enqueue returned an invalid outbound identifier'
      using errcode = '55000';
  end;
  if outbound_id is null
     or not exists (
       select 1 from public.messages_outbound outbound
        where outbound.id = outbound_id
          and outbound.sequence_step_id = step.id
          and outbound.status = 'queued'
     )
     or not exists (
       select 1 from public.outreach_sequence_steps bound_step
        where bound_step.id = step.id
          and bound_step.queued_outbound_id = outbound_id
     ) then
    raise exception 'atomic sequence enqueue did not produce a bound queued row'
      using errcode = '55000';
  end if;

  return json_build_object(
    'ok', true, 'reason', 'queued-and-bound', 'status', 'queued',
    'id', outbound_id, 'step_id', step.id, 'sequence_id', seq.id
  );
end;
$$;
revoke all on function public.enqueue_and_bind_sequence_step_outbound(uuid, uuid)
  from public, anon, service_role, authenticator;
grant execute on function public.enqueue_and_bind_sequence_step_outbound(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Provider claim wrappers. The mature provider policies remain in their
--    pre-0063 functions. The public service signatures first lock the sequence
--    parent, verify the reciprocal binding, and recheck tenant + protected
--    release controls immediately before queued -> dispatching.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.claim_email_outbound_queued_pre0063(uuid)') is null then
    if to_regprocedure('public.claim_email_outbound_queued(uuid)') is null then
      raise exception '0063 requires the pre-existing email claim function'
        using errcode = '42883';
    end if;
    alter function public.claim_email_outbound_queued(uuid)
      rename to claim_email_outbound_queued_pre0063;
  end if;
  if to_regprocedure('public.claim_whatsapp_outbound_pre0063(uuid)') is null then
    if to_regprocedure('public.claim_whatsapp_outbound(uuid)') is null then
      raise exception '0063 requires the pre-existing WhatsApp claim function'
        using errcode = '42883';
    end if;
    alter function public.claim_whatsapp_outbound(uuid)
      rename to claim_whatsapp_outbound_pre0063;
  end if;
end;
$$;

revoke all on function public.claim_email_outbound_queued_pre0063(uuid)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.claim_whatsapp_outbound_pre0063(uuid)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.prepare_sequence_outbound_claim(
  p_message_id uuid,
  p_channel text
) returns json
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  step_id uuid;
  sequence_authority_bound boolean;
  target_sequence_id uuid;
  seq public.outreach_sequences%rowtype;
  step public.outreach_sequence_steps%rowtype;
  outbound public.messages_outbound%rowtype;
begin
  if p_channel not in ('Email', 'WhatsApp') then
    return json_build_object('allowed', false, 'reason', 'unsupported-channel');
  end if;

  -- This lookup is intentionally unlocked. If the row is sequence-owned, the
  -- parent lock acquired next governs every later read and mutation.
  select sequence_step_id, messages_outbound.sequence_authority_bound
    into step_id, sequence_authority_bound
    from public.messages_outbound
   where id = p_message_id;
  if not found then
    return json_build_object('allowed', false, 'reason', 'outbound-not-found');
  end if;
  if step_id is null and sequence_authority_bound then
    return json_build_object('allowed', false, 'reason', 'sequence-binding-invalid');
  end if;
  if step_id is null then
    return json_build_object('allowed', true, 'sequence_bound', false);
  end if;
  select candidate_step.sequence_id into target_sequence_id
    from public.outreach_sequence_steps candidate_step
   where candidate_step.id = step_id;
  if not found then
    return json_build_object('allowed', false, 'reason', 'sequence-binding-invalid');
  end if;

  select * into seq from public.outreach_sequences
   where id = target_sequence_id
   for update;
  if not found then
    return json_build_object('allowed', false, 'reason', 'sequence-binding-invalid');
  end if;
  perform 1 from public.outreach_sequence_steps
   where sequence_id = seq.id
   order by ordinal
   for update;
  select * into step from public.outreach_sequence_steps
   where id = step_id and sequence_id = seq.id;
  if not found then
    return json_build_object('allowed', false, 'reason', 'sequence-binding-invalid');
  end if;
  select * into outbound from public.messages_outbound
   where id = p_message_id
   for update;
  if not found then
    return json_build_object('allowed', false, 'reason', 'sequence-binding-invalid');
  end if;

  -- Never stop or mutate on an untrusted pointer. Only a fully reciprocal and
  -- content-bound association is permitted to control sequence state.
  if step.channel <> p_channel
     or step.queued_outbound_id is distinct from outbound.id
     or outbound.sequence_step_id is distinct from step.id
     or outbound.workspace_id is distinct from seq.workspace_id
     or outbound.candidate_id is distinct from seq.candidate_id
     or outbound.campaign_id is distinct from seq.campaign_id
     or outbound.channel is distinct from p_channel
     or outbound.approval_message_id is distinct from step.message_id
     or outbound.body is distinct from step.body
     or coalesce(outbound.subject, '') <> ''
  then
    return json_build_object('allowed', false, 'reason', 'sequence-binding-invalid');
  end if;

  if outbound.status <> 'queued' then
    return json_build_object('allowed', false, 'reason', 'not-queued');
  end if;
  if seq.status <> 'active' or step.status <> 'scheduled' then
    update public.messages_outbound
       set status = 'cancelled'
     where id = outbound.id and status = 'queued';
    update public.outreach_sequence_steps
       set status = 'cancelled', verification_source = null
     where id = step.id and status = 'scheduled';
    return json_build_object('allowed', false, 'reason', 'sequence-not-dispatchable');
  end if;
  if step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
     or step.scope_hash is distinct from public.outreach_sequence_current_scope_hash(seq, step) then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object(
      'allowed', false, 'reason', 'approval-content-or-scope-mismatch'
    );
  end if;
  if not public.outreach_sequence_execution_enabled(seq.workspace_id) then
    perform public.outreach_sequence_stop_internal(seq.id, 'campaign');
    return json_build_object('allowed', false, 'reason', 'sequences-disabled');
  end if;
  if public.outreach_sequence_recipient_blocked(seq, step) then
    perform public.outreach_sequence_stop_internal(seq.id, 'optout');
    return json_build_object('allowed', false, 'reason', 'recipient-ineligible');
  end if;

  return json_build_object('allowed', true, 'sequence_bound', true);
end;
$$;
revoke all on function public.prepare_sequence_outbound_claim(uuid, text)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.claim_email_outbound_queued(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  guard_result json;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  guard_result := public.prepare_sequence_outbound_claim(p_message_id, 'Email');
  if coalesce((guard_result ->> 'allowed')::boolean, false) is not true then
    return guard_result;
  end if;
  return public.claim_email_outbound_queued_pre0063(p_message_id);
end;
$$;
revoke all on function public.claim_email_outbound_queued(uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.claim_email_outbound_queued(uuid) to service_role;

create or replace function public.claim_whatsapp_outbound(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  guard_result json;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  guard_result := public.prepare_sequence_outbound_claim(p_message_id, 'WhatsApp');
  if coalesce((guard_result ->> 'allowed')::boolean, false) is not true then
    return guard_result;
  end if;
  return public.claim_whatsapp_outbound_pre0063(p_message_id);
end;
$$;
revoke all on function public.claim_whatsapp_outbound(uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.claim_whatsapp_outbound(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. complete_sequence_step_send — durable completion for Email/WhatsApp
--    steps. Only marks 'sent' once the bound outbound row is itself
--    durably 'sent'; only then advances the ladder.
-- ---------------------------------------------------------------------------
create or replace function public.complete_sequence_step_send(p_step_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  step public.outreach_sequence_steps%rowtype;
  seq public.outreach_sequences%rowtype;
  outbound public.messages_outbound%rowtype;
  next_step public.outreach_sequence_steps%rowtype;
  outbound_recipient text;
  advanced boolean := false;
  stop_reason text;
  current_scope_hash text;
  target_sequence_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;

  select sequence_id into target_sequence_id
    from public.outreach_sequence_steps
   where id = p_step_id;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  select * into seq from public.outreach_sequences where id = target_sequence_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'sequence-not-found'); end if;
  select * into step from public.outreach_sequence_steps
   where id = p_step_id and sequence_id = seq.id
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;

  if step.status = 'sent' then
    return json_build_object('ok', true, 'reason', 'already-completed', 'step_id', step.id, 'sequence_id', step.sequence_id);
  end if;

  if step.status not in ('scheduled', 'cancelled')
     or step.channel not in ('Email', 'WhatsApp')
     or step.queued_outbound_id is null then
    return json_build_object('ok', false, 'reason', 'not-scheduled');
  end if;

  select * into outbound from public.messages_outbound where id = step.queued_outbound_id for update;
  outbound_recipient := case step.channel
    when 'Email' then nullif(lower(btrim(coalesce(outbound.to_address, ''))), '')
    when 'WhatsApp' then public.normalize_whatsapp_e164(outbound.to_address)
    else null
  end;
  if not found
     or outbound.workspace_id is distinct from seq.workspace_id
     or outbound.candidate_id is distinct from seq.candidate_id
     or outbound.channel is distinct from step.channel
     or outbound.approval_message_id is distinct from step.message_id
     or outbound.body is distinct from step.body
     or coalesce(outbound.subject, '') <> ''
     or outbound.sequence_step_id is distinct from step.id
     or outbound.status <> 'sent'
     or outbound.sent_at is null
     or outbound_recipient is null
     or step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
     or step.scope_hash is distinct from encode(
       digest(seq.candidate_id || E'\n' || step.channel || E'\n' || outbound_recipient, 'sha256'), 'hex'
     ) then
    return json_build_object('ok', false, 'reason', 'not-durably-sent');
  end if;

  -- `messages_outbound.sent` is an immutable external fact. Record it before
  -- deciding whether the sequence may advance. A kill, revocation, stop, or
  -- recipient change can stop future touches but cannot rewrite a real send
  -- as cancelled merely because its receipt arrived later.
  update public.outreach_sequence_steps
     set status = 'sent', sent_at = outbound.sent_at, completed_at = now(),
         verification_source = 'provider_confirmed'
   where id = step.id and status in ('scheduled', 'cancelled');

  if seq.status <> 'active' then
    return json_build_object(
      'ok', true, 'reason', 'sent-reconciled-terminal',
      'step_id', step.id, 'sequence_id', seq.id,
      'verification_source', 'provider_confirmed', 'advanced', false,
      'sequence_status', seq.status
    );
  end if;

  if not public.outreach_sequence_execution_enabled(seq.workspace_id) then
    stop_reason := 'campaign';
  else
    current_scope_hash := public.outreach_sequence_current_scope_hash(seq, step);
    if not exists (
      select 1 from public.outreach_approvals approval
       where approval.workspace_id = seq.workspace_id
         and approval.message_id = step.message_id
         and approval.body_hash = step.body_hash
         and approval.approval_scope_hash = step.scope_hash
         and approval.approval_source = 'human'
         and approval.revoked_at is null
       for update
    ) then
      stop_reason := 'manual';
    elsif current_scope_hash is distinct from step.scope_hash then
      stop_reason := 'manual';
    elsif public.outreach_sequence_recipient_blocked(seq, step) then
      stop_reason := 'optout';
    end if;
  end if;

  if stop_reason is not null then
    perform public.outreach_sequence_stop_internal(seq.id, stop_reason);
    return json_build_object(
      'ok', true, 'reason', 'sent-stopped',
      'step_id', step.id, 'sequence_id', seq.id,
      'verification_source', 'provider_confirmed', 'advanced', false,
      'stop_reason', stop_reason
    );
  end if;

  select * into next_step from public.outreach_sequence_steps
   where sequence_id = seq.id
     and ordinal = step.ordinal + 1
     and ordinal < seq.max_touches
     and status = 'waiting'
   for update;
  advanced := found;

  if advanced then
    update public.outreach_sequence_steps
       set status = 'due', due_at = now() + make_interval(days => next_step.gap_days)
     where id = next_step.id;
  else
    update public.outreach_sequence_steps
       set status = 'cancelled', verification_source = null
     where sequence_id = seq.id
       and ordinal > step.ordinal
       and status in ('waiting', 'due', 'scheduled', 'manual_task');
    update public.outreach_sequences set status = 'completed', updated_at = now() where id = seq.id;
  end if;

  return json_build_object(
    'ok', true, 'reason', 'sent', 'step_id', step.id, 'sequence_id', seq.id,
    'verification_source', 'provider_confirmed', 'advanced', advanced
  );
end; $$;
revoke all on function public.complete_sequence_step_send(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.complete_sequence_step_send(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. complete_sequence_manual_task — idempotent authenticated completion
--    for a LinkedIn manual_task step. The result is always an operator
--    assertion, never provider-confirmed delivery.
-- ---------------------------------------------------------------------------
create or replace function public.complete_sequence_manual_task(p_step_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  step public.outreach_sequence_steps%rowtype;
  seq public.outreach_sequences%rowtype;
  next_step public.outreach_sequence_steps%rowtype;
  advanced boolean := false;
  operator_id uuid := public.current_active_identity_id();
  role_name text := public.current_profile_role();
  actor_workspace_id uuid := public.current_workspace_id();
  scoped_step_id uuid;
  scoped_sequence_id uuid;
  receipt public.outreach_sequence_manual_action_receipts%rowtype;
  consumption_snapshot public.outreach_sequence_manual_approval_consumptions%rowtype;
begin
  if auth.uid() is null or operator_id is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if actor_workspace_id is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;

  -- Scope the identifier before examining state so a caller from another
  -- workspace cannot distinguish an existing manual task from a random UUID.
  select sequence_step.id, sequence_row.id into scoped_step_id, scoped_sequence_id
    from public.outreach_sequence_steps sequence_step
    join public.outreach_sequences sequence_row on sequence_row.id = sequence_step.sequence_id
   where sequence_step.id = p_step_id and sequence_row.workspace_id = actor_workspace_id;
  if scoped_step_id is null then return json_build_object('ok', false, 'reason', 'not-found'); end if;

  select * into seq from public.outreach_sequences
   where id = scoped_sequence_id and workspace_id = actor_workspace_id
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  select * into step from public.outreach_sequence_steps
   where id = scoped_step_id and sequence_id = seq.id
   for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;

  if step.status = 'sent' then
    if step.completed_by = operator_id then
      return json_build_object(
        'ok', true, 'reason', 'already-completed', 'step_id', step.id, 'sequence_id', step.sequence_id,
        'verification_source', 'operator_assertion'
      );
    end if;
    return json_build_object('ok', false, 'reason', 'completed-by-other');
  end if;

  select * into receipt
    from public.outreach_sequence_manual_action_receipts
   where outreach_sequence_manual_action_receipts.step_id = step.id;
  if found then
    if receipt.operator_id <> operator_id then
      return json_build_object('ok', false, 'reason', 'asserted-by-other');
    end if;
    return json_build_object(
      'ok', false, 'reason', 'operator-assertion-recorded-terminal',
      'assertion_recorded', true, 'completion_applied', false,
      'step_id', step.id, 'sequence_id', step.sequence_id,
      'verification_source', 'operator_assertion', 'advanced', false,
      'sequence_status', seq.status, 'step_status', step.status
    );
  end if;

  if step.channel <> 'LinkedIn'
     or step.status not in ('manual_task', 'cancelled')
     or step.scheduled_at is null then
    return json_build_object('ok', false, 'reason', 'not-manual-task');
  end if;

  -- A manual task is valid only if activation consumed the exact human
  -- approval snapshot for this step. Use the immutable consumption row here,
  -- not the live approval that may have been revoked after the browser action.
  select * into consumption_snapshot
    from public.outreach_sequence_manual_approval_consumptions
   where workspace_id = seq.workspace_id
     and sequence_id = seq.id
     and step_id = step.id
     and message_id = step.message_id
     and body_hash = step.body_hash
     and scope_hash = step.scope_hash;
  if not found then
    return json_build_object('ok', false, 'reason', 'manual-task-authority-missing');
  end if;

  insert into public.outreach_sequence_manual_action_receipts(
    step_id, workspace_id, sequence_id, operator_id, approval_id, message_id,
    body_hash, scope_hash, approved_by, approved_at, task_issued_at,
    asserted_from_status, sequence_status_at_assertion
  ) values (
    step.id, seq.workspace_id, seq.id, operator_id, consumption_snapshot.approval_id,
    step.message_id, step.body_hash, step.scope_hash,
    consumption_snapshot.approved_by, consumption_snapshot.approved_at, step.scheduled_at,
    step.status, seq.status
  );

  if seq.status <> 'active' or step.status = 'cancelled' then
    return json_build_object(
      'ok', false, 'reason', 'operator-assertion-recorded-terminal',
      'assertion_recorded', true, 'completion_applied', false,
      'step_id', step.id, 'sequence_id', step.sequence_id,
      'verification_source', 'operator_assertion', 'advanced', false,
      'sequence_status', seq.status, 'step_status', step.status
    );
  end if;

  if not public.outreach_sequence_execution_enabled(seq.workspace_id) then
    perform public.outreach_sequence_stop_internal(seq.id, 'campaign');
    return json_build_object(
      'ok', false, 'reason', 'operator-assertion-recorded-terminal',
      'assertion_recorded', true, 'completion_applied', false,
      'step_id', step.id, 'sequence_id', step.sequence_id,
      'verification_source', 'operator_assertion', 'advanced', false,
      'advance_blocked_reason', 'sequences-disabled'
    );
  end if;

  if step.body_hash is distinct from encode(digest(E'\n' || step.body, 'sha256'), 'hex')
     or step.scope_hash is distinct from public.outreach_sequence_current_scope_hash(seq, step)
  then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object(
      'ok', false, 'reason', 'operator-assertion-recorded-terminal',
      'assertion_recorded', true, 'completion_applied', false,
      'step_id', step.id, 'sequence_id', step.sequence_id,
      'verification_source', 'operator_assertion', 'advanced', false,
      'advance_blocked_reason', 'approval-content-or-scope-mismatch'
    );
  end if;

  if not exists (
    select 1
      from public.outreach_sequence_manual_approval_consumptions consumption
      join public.outreach_approvals approval on approval.id = consumption.approval_id
     where consumption.workspace_id = seq.workspace_id
       and consumption.sequence_id = seq.id
       and consumption.step_id = step.id
       and consumption.message_id = step.message_id
       and consumption.body_hash = step.body_hash
       and consumption.scope_hash = step.scope_hash
       and consumption.approved_by = approval.approved_by
       and consumption.approved_at = approval.approved_at
       and approval.workspace_id = seq.workspace_id
       and approval.message_id = step.message_id
       and approval.body_hash = step.body_hash
       and approval.approval_scope_hash = step.scope_hash
       and approval.approval_source = 'human'
       and approval.revoked_at is null
     for update of approval
  ) then
    perform public.outreach_sequence_stop_internal(seq.id, 'manual');
    return json_build_object(
      'ok', false, 'reason', 'operator-assertion-recorded-terminal',
      'assertion_recorded', true, 'completion_applied', false,
      'step_id', step.id, 'sequence_id', step.sequence_id,
      'verification_source', 'operator_assertion', 'advanced', false,
      'advance_blocked_reason', 'approval-revoked-or-consumed'
    );
  end if;

  if public.outreach_sequence_recipient_blocked(seq, step) then
    perform public.outreach_sequence_stop_internal(seq.id, 'optout');
    return json_build_object(
      'ok', false, 'reason', 'operator-assertion-recorded-terminal',
      'assertion_recorded', true, 'completion_applied', false,
      'step_id', step.id, 'sequence_id', step.sequence_id,
      'verification_source', 'operator_assertion', 'advanced', false,
      'advance_blocked_reason', 'recipient-ineligible'
    );
  end if;

  update public.outreach_sequence_steps
     set status = 'sent', sent_at = now(), completed_at = now(), completed_by = operator_id,
         verification_source = 'operator_assertion'
   where id = step.id and status = 'manual_task';

  select * into next_step from public.outreach_sequence_steps
   where sequence_id = seq.id
     and ordinal = step.ordinal + 1
     and ordinal < seq.max_touches
     and status = 'waiting'
   for update;
  advanced := found;

  if advanced then
    update public.outreach_sequence_steps
       set status = 'due', due_at = now() + make_interval(days => next_step.gap_days)
     where id = next_step.id;
  else
    update public.outreach_sequence_steps
       set status = 'cancelled', verification_source = null
     where sequence_id = seq.id
       and ordinal > step.ordinal
       and status in ('waiting', 'due', 'scheduled', 'manual_task');
    update public.outreach_sequences set status = 'completed', updated_at = now() where id = seq.id;
  end if;

  return json_build_object(
    'ok', true, 'reason', 'operator-assertion-recorded',
    'step_id', step.id, 'sequence_id', seq.id,
    'verification_source', 'operator_assertion', 'assertion_recorded', true,
    'completion_applied', true, 'advanced', advanced
  );
end; $$;
revoke all on function public.complete_sequence_manual_task(uuid) from public, anon, service_role, authenticator;
grant execute on function public.complete_sequence_manual_task(uuid) to authenticated;

alter function public.outreach_sequence_recipient_blocked(public.outreach_sequences, public.outreach_sequence_steps) owner to postgres;
alter function public.outreach_sequence_current_scope_hash(public.outreach_sequences, public.outreach_sequence_steps) owner to postgres;
alter function public.outreach_sequence_execution_enabled(uuid) owner to postgres;
alter function public.enforce_sequence_outbound_insert_origin() owner to postgres;
alter function public.enforce_sequence_outbound_insert_binding() owner to postgres;
alter function public.enforce_sequence_outbound_update_authority() owner to postgres;
alter function public.reject_sequence_manual_action_receipt_mutation() owner to postgres;
alter function public.outreach_sequence_stop_internal(uuid, text) owner to postgres;
alter function public.cleanup_erased_candidate_sequences() owner to postgres;
alter function public.normalize_linkedin_profile_url(text) owner to postgres;
alter function public.candidate_erasure_linkedin_canonical_hmac(uuid, text) owner to postgres;
alter function public.link_one_candidate(public.candidates) owner to postgres;
alter function public.canonicalize_candidate_erasure_linkedin_tombstone() owner to postgres;
alter function public.reject_legacy_linkedin_candidate_reimport() owner to postgres;
alter function public.activate_outreach_sequence(uuid) owner to postgres;
alter function public.stop_outreach_sequence(uuid, text) owner to postgres;
alter function public.claim_sequence_step_for_schedule(uuid) owner to postgres;
alter function public.bind_sequence_step_outbound(uuid, uuid) owner to postgres;
alter function public.enqueue_and_bind_sequence_step_outbound(uuid, uuid) owner to postgres;
alter function public.prepare_sequence_outbound_claim(uuid, text) owner to postgres;
alter function public.claim_email_outbound_queued_pre0063(uuid) owner to postgres;
alter function public.claim_email_outbound_queued(uuid) owner to postgres;
alter function public.claim_whatsapp_outbound_pre0063(uuid) owner to postgres;
alter function public.claim_whatsapp_outbound(uuid) owner to postgres;
alter function public.complete_sequence_step_send(uuid) owner to postgres;
alter function public.complete_sequence_manual_task(uuid) owner to postgres;
alter function public.outreach_sequence_tombstone_exists(uuid, text, text) owner to postgres;
