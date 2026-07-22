-- 0055_ai_runtime_binding_authority.sql
--
-- Normalized, dark-by-default authority for workspace AI provider, model, and
-- vault-key bindings. A workspace administrator stages a complete set. A
-- different administrator in the same workspace must activate it. SQL output
-- contains credential identity only; credential values never enter this slice.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

-- The composite identity is shared with other integration authorities. It is
-- present from 0019 in production; this guard keeps isolated migration tests
-- and restored older databases safe.
do $aria_ai_key_identity$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'api_keys_id_workspace_provider_key'
       and conrelid = 'public.api_keys'::regclass
  ) then
    alter table public.api_keys
      add constraint api_keys_id_workspace_provider_key
      unique (id, workspace_id, provider);
  end if;
end;
$aria_ai_key_identity$;

-- Execution credentials need durable evidence that a fixed, non-billable
-- provider readiness endpoint authenticated the exact key. Legacy `valid`
-- values were format-only and cannot authorize a production binding.
alter table public.api_keys
  add column if not exists verification_method text;
alter table public.api_keys
  add column if not exists verification_http_status integer;

-- Keep replay safe if an earlier revision of 0055 installed the lifecycle
-- trigger without live-verification evidence fields.
drop trigger if exists ai_bound_credential_enforce_lifecycle on public.api_keys;
update public.api_keys
   set status = 'untested'
 where provider in ('Anthropic', 'OpenAI', 'Groq', 'xAI', 'Mistral', 'Kimi (Moonshot)', 'Tavily')
   and status = 'valid'
   and verification_method is null;

create table if not exists public.ai_provider_catalog (
  provider_slug text primary key,
  credential_provider text not null,
  endpoint_profile text not null,
  supports_requisition_parse boolean not null,
  supports_sourcing boolean not null,
  catalog_revision smallint not null default 1,
  created_at timestamptz not null default now(),

  constraint ai_provider_catalog_provider_slug_check check (
    provider_slug = btrim(provider_slug)
    and octet_length(provider_slug) between 1 and 40
    and provider_slug ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint ai_provider_catalog_credential_provider_check check (
    credential_provider = btrim(credential_provider)
    and octet_length(credential_provider) between 1 and 80
    and credential_provider !~ '[[:cntrl:]]'
  ),
  constraint ai_provider_catalog_endpoint_profile_check check (
    endpoint_profile = btrim(endpoint_profile)
    and octet_length(endpoint_profile) between 1 and 100
    and endpoint_profile ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint ai_provider_catalog_capability_check check (
    supports_requisition_parse or supports_sourcing
  ),
  constraint ai_provider_catalog_revision_check check (catalog_revision > 0),
  constraint ai_provider_catalog_identity_key
    unique (provider_slug, credential_provider, endpoint_profile)
);

create table if not exists public.ai_runtime_model_evidence (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on update restrict on delete restrict,
  api_key_id uuid not null,
  provider_slug text not null,
  credential_provider text not null,
  endpoint_profile text not null,
  catalog_revision smallint not null,
  model_name text not null,
  purpose text not null,
  verification_method text not null,
  verification_http_status integer not null,
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  evidence_sha256 text not null,

  constraint ai_runtime_model_evidence_model_check check (
    model_name = btrim(model_name)
    and octet_length(model_name) between 1 and 200
    and model_name !~ '[[:cntrl:]]'
  ),
  constraint ai_runtime_model_evidence_purpose_check
    check (purpose in ('requisition_parse', 'sourcing')),
  constraint ai_runtime_model_evidence_method_check
    check (verification_method = 'provider_model_capability_v1'),
  constraint ai_runtime_model_evidence_http_check
    check (verification_http_status = 200),
  constraint ai_runtime_model_evidence_expiry_check
    check (expires_at = verified_at + interval '10 minutes'),
  constraint ai_runtime_model_evidence_hash_check check (
    evidence_sha256 ~ '^[0-9a-f]{64}$'
    and evidence_sha256 = encode(
      sha256(convert_to(concat_ws(E'\n',
        'aria.ai-runtime-model-evidence.v1',
        id::text,
        workspace_id::text,
        api_key_id::text,
        provider_slug,
        credential_provider,
        endpoint_profile,
        catalog_revision::text,
        model_name,
        purpose,
        verification_method,
        verification_http_status::text
      ), 'UTF8')),
      'hex'
    )
  ),
  constraint ai_runtime_model_evidence_id_workspace_key
    unique (id, workspace_id),
  constraint ai_runtime_model_evidence_api_key_fkey
    foreign key (api_key_id, workspace_id, credential_provider)
    references public.api_keys(id, workspace_id, provider)
    on update restrict on delete restrict,
  constraint ai_runtime_model_evidence_catalog_fkey
    foreign key (provider_slug, credential_provider, endpoint_profile)
    references public.ai_provider_catalog(provider_slug, credential_provider, endpoint_profile)
    on update restrict on delete restrict
);

create index if not exists ai_runtime_model_evidence_key_lookup_idx
  on public.ai_runtime_model_evidence(api_key_id, workspace_id, purpose, model_name);

create table if not exists public.ai_runtime_binding_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on update restrict on delete restrict,
  proposed_by uuid not null,
  reviewed_by uuid,
  idempotency_key uuid not null,
  request_sha256 text not null,
  set_sha256 text not null,
  status text not null default 'staged',
  proposed_at timestamptz not null default now(),
  reviewed_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  superseded_by_set_id uuid,

  constraint ai_runtime_binding_sets_request_hash_check
    check (request_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_runtime_binding_sets_set_hash_check
    check (set_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_runtime_binding_sets_status_check
    check (status in ('staged', 'active', 'superseded')),
  constraint ai_runtime_binding_sets_independent_reviewer_check
    check (reviewed_by is null or reviewed_by <> proposed_by),
  constraint ai_runtime_binding_sets_lifecycle_check check (
    (
      status = 'staged'
      and reviewed_by is null
      and reviewed_at is null
      and activated_at is null
      and superseded_at is null
      and superseded_by_set_id is null
    )
    or (
      status = 'active'
      and reviewed_by is not null
      and reviewed_at is not null
      and activated_at is not null
      and superseded_at is null
      and superseded_by_set_id is null
      and activated_at >= proposed_at
    )
    or (
      status = 'superseded'
      and reviewed_by is not null
      and reviewed_at is not null
      and activated_at is not null
      and superseded_at is not null
      and superseded_by_set_id is not null
      and activated_at >= proposed_at
      and superseded_at >= activated_at
    )
  ),
  constraint ai_runtime_binding_sets_workspace_id_idempotency_key
    unique (workspace_id, idempotency_key),
  constraint ai_runtime_binding_sets_id_workspace_key
    unique (id, workspace_id),
  constraint ai_runtime_binding_sets_superseding_set_fkey
    foreign key (superseded_by_set_id, workspace_id)
    references public.ai_runtime_binding_sets(id, workspace_id)
    on update restrict on delete restrict
);

create unique index if not exists ai_runtime_binding_sets_one_active_workspace_idx
  on public.ai_runtime_binding_sets(workspace_id)
  where status = 'active';

create table if not exists public.ai_runtime_bindings (
  id uuid primary key default gen_random_uuid(),
  binding_set_id uuid not null,
  workspace_id uuid not null,
  purpose text not null,
  provider_slug text not null,
  credential_provider text not null,
  endpoint_profile text not null,
  catalog_revision smallint not null,
  model_name text not null,
  api_key_id uuid not null,
  proposal_model_evidence_id uuid not null,
  activation_model_evidence_id uuid,
  config_sha256 text not null,
  created_at timestamptz not null default now(),

  constraint ai_runtime_bindings_purpose_check
    check (purpose in ('requisition_parse', 'sourcing')),
  constraint ai_runtime_bindings_model_check check (
    model_name = btrim(model_name)
    and octet_length(model_name) between 1 and 200
    and model_name !~ '[[:cntrl:]]'
  ),
  constraint ai_runtime_bindings_revision_check check (catalog_revision > 0),
  constraint ai_runtime_bindings_config_hash_check check (
    config_sha256 ~ '^[0-9a-f]{64}$'
    and config_sha256 = encode(
      sha256(convert_to(concat_ws(E'\n',
        'aria.ai-runtime-binding.v1',
        workspace_id::text,
        purpose,
        id::text,
        provider_slug,
        credential_provider,
        endpoint_profile,
        model_name,
        api_key_id::text,
        proposal_model_evidence_id::text,
        catalog_revision::text
      ), 'UTF8')),
      'hex'
    )
  ),
  constraint ai_runtime_bindings_set_purpose_key
    unique (binding_set_id, purpose),
  constraint ai_runtime_bindings_set_workspace_fkey
    foreign key (binding_set_id, workspace_id)
    references public.ai_runtime_binding_sets(id, workspace_id)
    on update restrict on delete restrict,
  constraint ai_runtime_bindings_catalog_fkey
    foreign key (provider_slug, credential_provider, endpoint_profile)
    references public.ai_provider_catalog(provider_slug, credential_provider, endpoint_profile)
    on update restrict on delete restrict,
  constraint ai_runtime_bindings_api_key_fkey
    foreign key (api_key_id, workspace_id, credential_provider)
    references public.api_keys(id, workspace_id, provider)
    on update restrict on delete restrict,
  constraint ai_runtime_bindings_proposal_evidence_fkey
    foreign key (proposal_model_evidence_id, workspace_id)
    references public.ai_runtime_model_evidence(id, workspace_id)
    on update restrict on delete restrict,
  constraint ai_runtime_bindings_activation_evidence_fkey
    foreign key (activation_model_evidence_id, workspace_id)
    references public.ai_runtime_model_evidence(id, workspace_id)
    on update restrict on delete restrict
);

create index if not exists ai_runtime_bindings_api_key_identity_idx
  on public.ai_runtime_bindings(api_key_id, workspace_id, credential_provider);

create table if not exists public.ai_runtime_binding_receipts (
  id uuid primary key,
  workspace_id uuid not null,
  binding_set_id uuid not null,
  idempotency_key uuid not null,
  event_type text not null,
  actor_id uuid not null,
  related_binding_set_id uuid,
  set_sha256 text not null,
  receipt_sha256 text not null,
  created_at timestamptz not null default now(),

  constraint ai_runtime_binding_receipts_event_check
    check (event_type in ('staged', 'activated', 'superseded')),
  constraint ai_runtime_binding_receipts_set_hash_check
    check (set_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_runtime_binding_receipts_hash_check check (
    receipt_sha256 ~ '^[0-9a-f]{64}$'
    and receipt_sha256 = encode(
      sha256(convert_to(concat_ws(E'\n',
        'aria.ai-runtime-binding-receipt.v1',
        id::text,
        workspace_id::text,
        binding_set_id::text,
        idempotency_key::text,
        event_type,
        actor_id::text,
        coalesce(related_binding_set_id::text, ''),
        set_sha256
      ), 'UTF8')),
      'hex'
    )
  ),
  constraint ai_runtime_binding_receipts_operation_key
    unique (workspace_id, idempotency_key, event_type, binding_set_id),
  constraint ai_runtime_binding_receipts_set_workspace_fkey
    foreign key (binding_set_id, workspace_id)
    references public.ai_runtime_binding_sets(id, workspace_id)
    on update restrict on delete restrict,
  constraint ai_runtime_binding_receipts_related_workspace_fkey
    foreign key (related_binding_set_id, workspace_id)
    references public.ai_runtime_binding_sets(id, workspace_id)
    on update restrict on delete restrict
);

create index if not exists ai_runtime_binding_receipts_operation_lookup_idx
  on public.ai_runtime_binding_receipts(workspace_id, idempotency_key, event_type);

insert into public.ai_provider_catalog (
  provider_slug,
  credential_provider,
  endpoint_profile,
  supports_requisition_parse,
  supports_sourcing,
  catalog_revision
) values
  ('anthropic', 'Anthropic', 'anthropic_messages_2023_06_01', true, true, 1),
  ('openai', 'OpenAI', 'openai_chat_completions_v1', true, true, 1),
  ('groq', 'Groq', 'groq_chat_completions_v1', true, true, 1),
  ('xai', 'xAI', 'xai_chat_completions_v1', true, true, 1),
  ('mistral', 'Mistral', 'mistral_chat_completions_v1', true, true, 1),
  -- Kimi is OpenAI-compatible, but an exact model is never trusted from this
  -- catalog flag alone. Staging and activation each require a fresh, nonce-bound
  -- sourcing tool-call capability receipt for the selected model.
  ('kimi', 'Kimi (Moonshot)', 'moonshot_chat_completions_v1', true, true, 2)
on conflict (provider_slug) do nothing;

do $aria_ai_provider_catalog_exact$
begin
  if (select count(*) from public.ai_provider_catalog) <> 6
     or exists (
       select 1
         from public.ai_provider_catalog catalog
        where (catalog.provider_slug, catalog.credential_provider, catalog.endpoint_profile,
               catalog.supports_requisition_parse, catalog.supports_sourcing, catalog.catalog_revision)
          not in (
            ('anthropic', 'Anthropic', 'anthropic_messages_2023_06_01', true, true, 1::smallint),
            ('openai', 'OpenAI', 'openai_chat_completions_v1', true, true, 1::smallint),
            ('groq', 'Groq', 'groq_chat_completions_v1', true, true, 1::smallint),
            ('xai', 'xAI', 'xai_chat_completions_v1', true, true, 1::smallint),
            ('mistral', 'Mistral', 'mistral_chat_completions_v1', true, true, 1::smallint),
            ('kimi', 'Kimi (Moonshot)', 'moonshot_chat_completions_v1', true, true, 2::smallint)
          )
     ) then
    raise exception 'AI provider catalog does not match reviewed revision 1'
      using errcode = '55000';
  end if;
end;
$aria_ai_provider_catalog_exact$;

alter table public.ai_provider_catalog enable row level security;
alter table public.ai_provider_catalog force row level security;
alter table public.ai_runtime_model_evidence enable row level security;
alter table public.ai_runtime_model_evidence force row level security;
alter table public.ai_runtime_binding_sets enable row level security;
alter table public.ai_runtime_binding_sets force row level security;
alter table public.ai_runtime_bindings enable row level security;
alter table public.ai_runtime_bindings force row level security;
alter table public.ai_runtime_binding_receipts enable row level security;
alter table public.ai_runtime_binding_receipts force row level security;

revoke all on public.ai_provider_catalog
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.ai_runtime_model_evidence
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.ai_runtime_binding_sets
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.ai_runtime_bindings
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.ai_runtime_binding_receipts
  from public, anon, authenticated, service_role, authenticator;

drop policy if exists ai_provider_catalog_owner_access on public.ai_provider_catalog;
create policy ai_provider_catalog_owner_access on public.ai_provider_catalog
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists ai_runtime_model_evidence_owner_access on public.ai_runtime_model_evidence;
create policy ai_runtime_model_evidence_owner_access on public.ai_runtime_model_evidence
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists ai_runtime_binding_sets_owner_access on public.ai_runtime_binding_sets;
create policy ai_runtime_binding_sets_owner_access on public.ai_runtime_binding_sets
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists ai_runtime_bindings_owner_access on public.ai_runtime_bindings;
create policy ai_runtime_bindings_owner_access on public.ai_runtime_bindings
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists ai_runtime_binding_receipts_owner_access on public.ai_runtime_binding_receipts;
create policy ai_runtime_binding_receipts_owner_access on public.ai_runtime_binding_receipts
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.reject_ai_provider_catalog_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     and exists (
       select 1
         from public.ai_provider_catalog catalog
        where catalog.provider_slug = new.provider_slug
          and catalog.credential_provider = new.credential_provider
          and catalog.endpoint_profile = new.endpoint_profile
          and catalog.supports_requisition_parse = new.supports_requisition_parse
          and catalog.supports_sourcing = new.supports_sourcing
          and catalog.catalog_revision = new.catalog_revision
     ) then
    return new;
  end if;
  raise exception 'AI provider catalog rows are immutable' using errcode = '55000';
end;
$$;

create or replace function public.reject_ai_runtime_binding_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('aria.ai_runtime_binding_evidence_authorized', true), '') = '0055'
     and old.activation_model_evidence_id is null
     and new.activation_model_evidence_id is not null
     and (to_jsonb(new) - 'activation_model_evidence_id')
       = (to_jsonb(old) - 'activation_model_evidence_id') then
    return new;
  end if;
  raise exception 'AI runtime binding rows are immutable' using errcode = '55000';
end;
$$;

create or replace function public.reject_ai_runtime_model_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'AI runtime model evidence is immutable' using errcode = '55000';
end;
$$;

create or replace function public.reject_ai_runtime_binding_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'AI runtime binding receipts are immutable' using errcode = '55000';
end;
$$;

create or replace function public.enforce_ai_runtime_binding_set_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AI runtime binding set rows cannot be deleted' using errcode = '55000';
  end if;
  if new is not distinct from old then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.proposed_by is distinct from old.proposed_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_sha256 is distinct from old.request_sha256
     or new.set_sha256 is distinct from old.set_sha256
     or new.proposed_at is distinct from old.proposed_at then
    raise exception 'AI runtime binding set identity is immutable' using errcode = '55000';
  end if;
  if coalesce(current_setting('aria.ai_runtime_binding_lifecycle_authorized', true), '') <> '0055' then
    raise exception 'AI runtime binding lifecycle requires reviewed activation authority'
      using errcode = '55000';
  end if;
  if old.status = 'staged' and new.status = 'active' then
    if new.reviewed_by is null
       or new.reviewed_by = old.proposed_by
       or new.reviewed_at is null
       or new.activated_at is null
       or new.superseded_at is not null
       or new.superseded_by_set_id is not null then
      raise exception 'invalid AI runtime binding activation transition' using errcode = '55000';
    end if;
    return new;
  end if;
  if old.status = 'active' and new.status = 'superseded' then
    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.activated_at is distinct from old.activated_at
       or new.superseded_at is null
       or new.superseded_by_set_id is null then
      raise exception 'invalid AI runtime binding supersession transition' using errcode = '55000';
    end if;
    return new;
  end if;
  raise exception 'invalid AI runtime binding lifecycle transition' using errcode = '55000';
end;
$$;

-- A binding approves the identity of an existing credential row. If the row's
-- tenant, provider, encrypted value, or display fingerprint could be rewritten
-- in place, one administrator could silently substitute a different secret
-- after independent review. Credential rotation therefore creates a new
-- api_keys row and a new binding set. Revocation remains immediately available;
-- only the service-owned key-test workflow may restore a tested row to valid.
create or replace function public.ai_execution_credential_verified(
  p_provider text,
  p_status text,
  p_last_tested_at timestamptz,
  p_verification_method text,
  p_verification_http_status integer
) returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    p_status = 'valid'
      and p_last_tested_at is not null
      and p_verification_http_status = 200
      and (
        (
          p_provider in ('Anthropic', 'OpenAI', 'Groq', 'xAI', 'Mistral', 'Kimi (Moonshot)')
          and p_verification_method = 'provider_models_list_v1'
        )
        or (
          p_provider = 'Tavily'
          and p_verification_method in ('tavily_usage_v1', 'tavily_key_info_v1')
        )
      ),
    false
  );
$$;

create or replace function public.enforce_ai_bound_credential_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  caller_role text := coalesce(auth.role(), '');
  tested_at_is_monotonic boolean;
begin
  if tg_op = 'INSERT' then
    if caller_role in ('anon', 'authenticated', 'service_role')
       and new.status <> 'untested' then
      raise exception 'new API credentials require verification before use'
        using errcode = '55000';
    end if;
    if new.provider in ('Anthropic', 'OpenAI', 'Groq', 'xAI', 'Mistral', 'Kimi (Moonshot)', 'Tavily')
       and new.status = 'valid'
       and not public.ai_execution_credential_verified(
         new.provider,
         new.status,
         new.last_tested_at,
         new.verification_method,
         new.verification_http_status
       ) then
      raise exception 'execution credentials require live provider verification'
        using errcode = '55000';
    end if;
    if new.provider in ('Anthropic', 'OpenAI', 'Groq', 'xAI', 'Mistral', 'Kimi (Moonshot)', 'Tavily')
       and new.status <> 'valid' then
      new.verification_method := null;
      new.verification_http_status := null;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.provider is distinct from old.provider
     or new.secret is distinct from old.secret
     or new.last4 is distinct from old.last4
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'API credential identity is immutable; rotate with a new row'
      using errcode = '55000';
  end if;

  if (
    new.verification_method is distinct from old.verification_method
    or new.verification_http_status is distinct from old.verification_http_status
  ) and caller_role <> 'service_role' then
    raise exception 'only the verified key-test workflow may write provider evidence'
      using errcode = '55000';
  end if;

  if new.provider in ('Anthropic', 'OpenAI', 'Groq', 'xAI', 'Mistral', 'Kimi (Moonshot)', 'Tavily')
     and new.status <> 'valid' then
    new.verification_method := null;
    new.verification_http_status := null;
  end if;

  if new.status not in ('untested', 'valid', 'invalid') then
    raise exception 'invalid API credential lifecycle status'
      using errcode = '55000';
  end if;

  tested_at_is_monotonic := new.last_tested_at is not null
    and (old.last_tested_at is null or new.last_tested_at >= old.last_tested_at);

  if new.provider in ('Anthropic', 'OpenAI', 'Groq', 'xAI', 'Mistral', 'Kimi (Moonshot)', 'Tavily')
     and new.status = 'valid'
     and not public.ai_execution_credential_verified(
       new.provider,
       new.status,
       new.last_tested_at,
       new.verification_method,
       new.verification_http_status
     ) then
    raise exception 'execution credentials require live provider verification'
      using errcode = '55000';
  end if;

  if new.status is distinct from old.status then
    if new.status in ('invalid', 'untested') then
      if new.last_tested_at is distinct from old.last_tested_at
         and (caller_role <> 'service_role' or not tested_at_is_monotonic) then
        raise exception 'only the verified key-test workflow may write test evidence'
          using errcode = '55000';
      end if;
      return new;
    end if;

    if new.status = 'valid'
       and caller_role = 'service_role'
       and tested_at_is_monotonic then
      return new;
    end if;

    raise exception 'only the verified key-test workflow may mark a credential valid'
      using errcode = '55000';
  end if;

  if new.last_tested_at is distinct from old.last_tested_at
     and (caller_role <> 'service_role' or not tested_at_is_monotonic) then
    raise exception 'only the verified key-test workflow may write test evidence'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

alter function public.reject_ai_provider_catalog_mutation() owner to postgres;
alter function public.reject_ai_runtime_binding_mutation() owner to postgres;
alter function public.reject_ai_runtime_model_evidence_mutation() owner to postgres;
alter function public.reject_ai_runtime_binding_receipt_mutation() owner to postgres;
alter function public.enforce_ai_runtime_binding_set_lifecycle() owner to postgres;
alter function public.ai_execution_credential_verified(text, text, timestamptz, text, integer) owner to postgres;
alter function public.enforce_ai_bound_credential_lifecycle() owner to postgres;
revoke all on function public.reject_ai_provider_catalog_mutation()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.reject_ai_runtime_binding_mutation()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.reject_ai_runtime_model_evidence_mutation()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.reject_ai_runtime_binding_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.enforce_ai_runtime_binding_set_lifecycle()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.ai_execution_credential_verified(text, text, timestamptz, text, integer)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.enforce_ai_bound_credential_lifecycle()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists ai_provider_catalog_reject_mutation on public.ai_provider_catalog;
create trigger ai_provider_catalog_reject_mutation
  before insert or update or delete on public.ai_provider_catalog
  for each row execute function public.reject_ai_provider_catalog_mutation();
drop trigger if exists ai_runtime_bindings_reject_mutation on public.ai_runtime_bindings;
create trigger ai_runtime_bindings_reject_mutation
  before update or delete on public.ai_runtime_bindings
  for each row execute function public.reject_ai_runtime_binding_mutation();
drop trigger if exists ai_runtime_model_evidence_reject_mutation on public.ai_runtime_model_evidence;
create trigger ai_runtime_model_evidence_reject_mutation
  before update or delete on public.ai_runtime_model_evidence
  for each row execute function public.reject_ai_runtime_model_evidence_mutation();
drop trigger if exists ai_runtime_binding_receipts_reject_mutation on public.ai_runtime_binding_receipts;
create trigger ai_runtime_binding_receipts_reject_mutation
  before update or delete on public.ai_runtime_binding_receipts
  for each row execute function public.reject_ai_runtime_binding_receipt_mutation();
drop trigger if exists ai_runtime_binding_sets_enforce_lifecycle on public.ai_runtime_binding_sets;
create trigger ai_runtime_binding_sets_enforce_lifecycle
  before update or delete on public.ai_runtime_binding_sets
  for each row execute function public.enforce_ai_runtime_binding_set_lifecycle();
drop trigger if exists ai_bound_credential_enforce_lifecycle on public.api_keys;
create trigger ai_bound_credential_enforce_lifecycle
  before insert or update on public.api_keys
  for each row execute function public.enforce_ai_bound_credential_lifecycle();

create or replace function public.record_ai_runtime_model_evidence(
  p_expected_workspace_id uuid,
  p_api_key_id uuid,
  p_credential_provider text,
  p_model_name text,
  p_purpose text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  catalog_row public.ai_provider_catalog%rowtype;
  evidence_id uuid := gen_random_uuid();
  evidence_verified_at timestamptz := clock_timestamp();
  evidence_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_expected_workspace_id is null
     or p_api_key_id is null
     or p_credential_provider is null
     or p_model_name is null
     or p_purpose is null
     or p_credential_provider <> btrim(p_credential_provider)
     or p_model_name <> btrim(p_model_name)
     or octet_length(p_model_name) not between 1 and 200
     or p_model_name ~ '[[:cntrl:]]'
     or p_purpose not in ('requisition_parse', 'sourcing') then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into catalog_row
    from public.ai_provider_catalog catalog
   where catalog.credential_provider = p_credential_provider
     and case p_purpose
       when 'requisition_parse' then catalog.supports_requisition_parse
       when 'sourcing' then catalog.supports_sourcing
       else false
     end;
  if not found then
    return jsonb_build_object('status', 'provider_unsupported');
  end if;

  perform 1
    from public.api_keys key_row
   where key_row.id = p_api_key_id
     and key_row.workspace_id = p_expected_workspace_id
     and key_row.provider = p_credential_provider
     and public.ai_execution_credential_verified(
       key_row.provider,
       key_row.status,
       key_row.last_tested_at,
       key_row.verification_method,
       key_row.verification_http_status
     )
   for share;
  if not found then
    return jsonb_build_object('status', 'credential_unavailable');
  end if;

  evidence_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.ai-runtime-model-evidence.v1',
    evidence_id::text,
    p_expected_workspace_id::text,
    p_api_key_id::text,
    catalog_row.provider_slug,
    catalog_row.credential_provider,
    catalog_row.endpoint_profile,
    catalog_row.catalog_revision::text,
    p_model_name,
    p_purpose,
    'provider_model_capability_v1',
    '200'
  ), 'UTF8')), 'hex');

  insert into public.ai_runtime_model_evidence (
    id, workspace_id, api_key_id, provider_slug, credential_provider,
    endpoint_profile, catalog_revision, model_name, purpose,
    verification_method, verification_http_status, verified_at, expires_at,
    evidence_sha256
  ) values (
    evidence_id, p_expected_workspace_id, p_api_key_id,
    catalog_row.provider_slug, catalog_row.credential_provider,
    catalog_row.endpoint_profile, catalog_row.catalog_revision,
    p_model_name, p_purpose, 'provider_model_capability_v1', 200,
    evidence_verified_at, evidence_verified_at + interval '10 minutes',
    evidence_hash
  );

  return jsonb_build_object(
    'status', 'recorded',
    'evidence_id', evidence_id,
    'evidence_sha256', evidence_hash
  );
end;
$$;

create or replace function public.ai_runtime_model_evidence_matches(
  p_evidence_id uuid,
  p_workspace_id uuid,
  p_api_key_id uuid,
  p_provider_slug text,
  p_credential_provider text,
  p_endpoint_profile text,
  p_catalog_revision smallint,
  p_model_name text,
  p_purpose text,
  p_require_fresh boolean
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.ai_runtime_model_evidence evidence
     where evidence.id = p_evidence_id
       and evidence.workspace_id = p_workspace_id
       and evidence.api_key_id = p_api_key_id
       and evidence.provider_slug = p_provider_slug
       and evidence.credential_provider = p_credential_provider
       and evidence.endpoint_profile = p_endpoint_profile
       and evidence.catalog_revision = p_catalog_revision
       and evidence.model_name = p_model_name
       and evidence.purpose = p_purpose
       and evidence.verification_method = 'provider_model_capability_v1'
       and evidence.verification_http_status = 200
       and (
         not p_require_fresh
         or (
           evidence.verified_at <= clock_timestamp()
           and evidence.expires_at >= clock_timestamp()
         )
       )
  );
$$;

alter function public.record_ai_runtime_model_evidence(uuid, uuid, text, text, text)
  owner to postgres;
alter function public.ai_runtime_model_evidence_matches(
  uuid, uuid, uuid, text, text, text, smallint, text, text, boolean
) owner to postgres;
revoke all on function public.record_ai_runtime_model_evidence(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.record_ai_runtime_model_evidence(uuid, uuid, text, text, text) to service_role;
revoke all on function public.ai_runtime_model_evidence_matches(
  uuid, uuid, uuid, text, text, text, smallint, text, text, boolean
) from public, anon, authenticated, service_role, authenticator;

create or replace function public.ai_runtime_binding_set_structurally_valid(
  p_binding_set_id uuid,
  p_workspace_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.ai_runtime_binding_sets binding_set
      join public.ai_runtime_bindings parse_binding
        on parse_binding.binding_set_id = binding_set.id
       and parse_binding.workspace_id = binding_set.workspace_id
       and parse_binding.purpose = 'requisition_parse'
      join public.ai_provider_catalog parse_catalog
        on parse_catalog.provider_slug = parse_binding.provider_slug
       and parse_catalog.credential_provider = parse_binding.credential_provider
       and parse_catalog.endpoint_profile = parse_binding.endpoint_profile
      join public.ai_runtime_bindings sourcing_binding
        on sourcing_binding.binding_set_id = binding_set.id
       and sourcing_binding.workspace_id = binding_set.workspace_id
       and sourcing_binding.purpose = 'sourcing'
      join public.ai_provider_catalog sourcing_catalog
        on sourcing_catalog.provider_slug = sourcing_binding.provider_slug
       and sourcing_catalog.credential_provider = sourcing_binding.credential_provider
       and sourcing_catalog.endpoint_profile = sourcing_binding.endpoint_profile
     where binding_set.id = p_binding_set_id
       and binding_set.workspace_id = p_workspace_id
       and parse_catalog.supports_requisition_parse
       and sourcing_catalog.supports_sourcing
       and parse_catalog.catalog_revision = parse_binding.catalog_revision
       and sourcing_catalog.catalog_revision = sourcing_binding.catalog_revision
       and public.ai_runtime_model_evidence_matches(
         parse_binding.proposal_model_evidence_id,
         parse_binding.workspace_id,
         parse_binding.api_key_id,
         parse_binding.provider_slug,
         parse_binding.credential_provider,
         parse_binding.endpoint_profile,
         parse_binding.catalog_revision,
         parse_binding.model_name,
         'requisition_parse',
         false
       )
       and public.ai_runtime_model_evidence_matches(
         sourcing_binding.proposal_model_evidence_id,
         sourcing_binding.workspace_id,
         sourcing_binding.api_key_id,
         sourcing_binding.provider_slug,
         sourcing_binding.credential_provider,
         sourcing_binding.endpoint_profile,
         sourcing_binding.catalog_revision,
         sourcing_binding.model_name,
         'sourcing',
         false
       )
       and (
         (
           binding_set.status = 'staged'
           and parse_binding.activation_model_evidence_id is null
           and sourcing_binding.activation_model_evidence_id is null
         )
         or (
           binding_set.status in ('active', 'superseded')
           and public.ai_runtime_model_evidence_matches(
             parse_binding.activation_model_evidence_id,
             parse_binding.workspace_id,
             parse_binding.api_key_id,
             parse_binding.provider_slug,
             parse_binding.credential_provider,
             parse_binding.endpoint_profile,
             parse_binding.catalog_revision,
             parse_binding.model_name,
             'requisition_parse',
             false
           )
           and public.ai_runtime_model_evidence_matches(
             sourcing_binding.activation_model_evidence_id,
             sourcing_binding.workspace_id,
             sourcing_binding.api_key_id,
             sourcing_binding.provider_slug,
             sourcing_binding.credential_provider,
             sourcing_binding.endpoint_profile,
             sourcing_binding.catalog_revision,
             sourcing_binding.model_name,
             'sourcing',
             false
           )
         )
       )
       and (select count(*) from public.ai_runtime_bindings child
             where child.binding_set_id = binding_set.id) = 2
       and binding_set.set_sha256 = encode(sha256(convert_to(concat_ws(E'\n',
         'aria.ai-runtime-binding-set.v1',
         binding_set.workspace_id::text,
         binding_set.id::text,
         binding_set.request_sha256,
         parse_binding.config_sha256,
         sourcing_binding.config_sha256
       ), 'UTF8')), 'hex')
  );
$$;

create or replace function public.ai_runtime_binding_set_credentials_valid(
  p_binding_set_id uuid,
  p_workspace_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    (select count(*) from public.ai_runtime_bindings binding
      where binding.binding_set_id = p_binding_set_id
        and binding.workspace_id = p_workspace_id) = 2
    and not exists (
      select 1
        from public.ai_runtime_bindings binding
       where binding.binding_set_id = p_binding_set_id
         and binding.workspace_id = p_workspace_id
         and not exists (
           select 1
             from public.api_keys key_row
            where key_row.id = binding.api_key_id
              and key_row.workspace_id = binding.workspace_id
              and key_row.provider = binding.credential_provider
              and public.ai_execution_credential_verified(
                key_row.provider,
                key_row.status,
                key_row.last_tested_at,
                key_row.verification_method,
                key_row.verification_http_status
              )
         )
    );
$$;

create or replace function public.insert_ai_runtime_binding_receipt(
  p_workspace_id uuid,
  p_binding_set_id uuid,
  p_idempotency_key uuid,
  p_event_type text,
  p_actor_id uuid,
  p_related_binding_set_id uuid,
  p_set_sha256 text
) returns public.ai_runtime_binding_receipts
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  receipt_id uuid := gen_random_uuid();
  receipt_hash text;
  inserted_receipt public.ai_runtime_binding_receipts%rowtype;
begin
  receipt_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.ai-runtime-binding-receipt.v1',
    receipt_id::text,
    p_workspace_id::text,
    p_binding_set_id::text,
    p_idempotency_key::text,
    p_event_type,
    p_actor_id::text,
    coalesce(p_related_binding_set_id::text, ''),
    p_set_sha256
  ), 'UTF8')), 'hex');

  insert into public.ai_runtime_binding_receipts (
    id, workspace_id, binding_set_id, idempotency_key, event_type,
    actor_id, related_binding_set_id, set_sha256, receipt_sha256
  ) values (
    receipt_id, p_workspace_id, p_binding_set_id, p_idempotency_key,
    p_event_type, p_actor_id, p_related_binding_set_id, p_set_sha256,
    receipt_hash
  ) returning * into inserted_receipt;
  return inserted_receipt;
end;
$$;

alter function public.ai_runtime_binding_set_structurally_valid(uuid, uuid) owner to postgres;
alter function public.ai_runtime_binding_set_credentials_valid(uuid, uuid) owner to postgres;
alter function public.insert_ai_runtime_binding_receipt(uuid, uuid, uuid, text, uuid, uuid, text)
  owner to postgres;
revoke all on function public.ai_runtime_binding_set_structurally_valid(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.ai_runtime_binding_set_credentials_valid(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.insert_ai_runtime_binding_receipt(uuid, uuid, uuid, text, uuid, uuid, text)
  from public, anon, authenticated, service_role, authenticator;

-- Retire the original service-role overloads. A service caller could supply
-- arbitrary proposer/reviewer identities, which made four-eyes evidence
-- forgeable. Human mutations below derive both actor and tenant from JWT.
drop function if exists public.stage_ai_runtime_binding_set(
  uuid, uuid, uuid, text, text, uuid, text, text, uuid
);
drop function if exists public.activate_ai_runtime_binding_set(uuid, uuid, uuid, uuid);
drop function if exists public.stage_ai_runtime_binding_set(
  uuid, text, text, uuid, text, text, uuid
);
drop function if exists public.activate_ai_runtime_binding_set(uuid, uuid);

create or replace function public.stage_ai_runtime_binding_set(
  p_idempotency_key uuid,
  p_parse_provider_slug text,
  p_parse_model_name text,
  p_parse_api_key_id uuid,
  p_parse_model_evidence_id uuid,
  p_sourcing_provider_slug text,
  p_sourcing_model_name text,
  p_sourcing_api_key_id uuid,
  p_sourcing_model_evidence_id uuid,
  p_expected_workspace_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  caller_id uuid := auth.uid();
  existing_set public.ai_runtime_binding_sets%rowtype;
  existing_receipt public.ai_runtime_binding_receipts%rowtype;
  parse_catalog public.ai_provider_catalog%rowtype;
  sourcing_catalog public.ai_provider_catalog%rowtype;
  binding_set_id uuid;
  parse_binding_id uuid;
  sourcing_binding_id uuid;
  request_hash text;
  parse_config_hash text;
  sourcing_config_hash text;
  binding_set_hash text;
  staged_receipt public.ai_runtime_binding_receipts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if p_expected_workspace_id is null
     or caller_workspace is distinct from p_expected_workspace_id then
    return jsonb_build_object('status', 'workspace_conflict');
  end if;
  perform 1
    from public.profiles proposer
   where proposer.id = caller_id
     and proposer.workspace_id = caller_workspace
     and proposer.role = 'admin'
   for share;
  if not found then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or p_parse_provider_slug is null
     or p_parse_model_name is null
     or p_parse_api_key_id is null
     or p_parse_model_evidence_id is null
     or p_sourcing_provider_slug is null
     or p_sourcing_model_name is null
     or p_sourcing_api_key_id is null
     or p_sourcing_model_evidence_id is null
     or p_parse_model_evidence_id = p_sourcing_model_evidence_id
     or p_parse_provider_slug <> btrim(p_parse_provider_slug)
     or p_sourcing_provider_slug <> btrim(p_sourcing_provider_slug)
     or p_parse_model_name <> btrim(p_parse_model_name)
     or p_sourcing_model_name <> btrim(p_sourcing_model_name)
     or octet_length(p_parse_model_name) not between 1 and 200
     or octet_length(p_sourcing_model_name) not between 1 and 200
     or p_parse_model_name ~ '[[:cntrl:]]'
     or p_sourcing_model_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock_shared(550055202607210055::bigint);
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.ai-runtime-binding-workspace.v1' || E'\n' || caller_workspace::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.ai-runtime-binding-stage.v1' || E'\n' || caller_workspace::text || E'\n' || p_idempotency_key::text,
    0
  ));

  request_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.ai-runtime-binding-request.v1',
    caller_workspace::text,
    caller_id::text,
    p_parse_provider_slug,
    p_parse_model_name,
    p_parse_api_key_id::text,
    p_sourcing_provider_slug,
    p_sourcing_model_name,
    p_sourcing_api_key_id::text
  ), 'UTF8')), 'hex');

  select * into existing_set
    from public.ai_runtime_binding_sets binding_set
   where binding_set.workspace_id = caller_workspace
     and binding_set.idempotency_key = p_idempotency_key
   for update;
  if found then
    if existing_set.request_sha256 is distinct from request_hash then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    if not public.ai_runtime_binding_set_structurally_valid(existing_set.id, caller_workspace) then
      return jsonb_build_object('status', 'authority_invalid');
    end if;
    if not public.ai_runtime_binding_set_credentials_valid(existing_set.id, caller_workspace) then
      return jsonb_build_object('status', 'credential_unavailable');
    end if;
    select * into existing_receipt
      from public.ai_runtime_binding_receipts receipt
     where receipt.workspace_id = caller_workspace
       and receipt.binding_set_id = existing_set.id
       and receipt.idempotency_key = p_idempotency_key
       and receipt.event_type = 'staged';
    if not found then
      return jsonb_build_object('status', 'authority_invalid');
    end if;
    return jsonb_build_object(
      'status', existing_set.status,
      'replay', true,
      'binding_set_id', existing_set.id,
      'set_sha256', existing_set.set_sha256,
      'receipt_sha256', existing_receipt.receipt_sha256
    );
  end if;

  if (
    select count(*)
      from public.ai_runtime_binding_sets binding_set
     where binding_set.workspace_id = caller_workspace
       and binding_set.status = 'staged'
  ) >= 99 then
    return jsonb_build_object('status', 'staged_limit_reached');
  end if;

  select * into parse_catalog
    from public.ai_provider_catalog catalog
   where catalog.provider_slug = p_parse_provider_slug;
  if not found or not parse_catalog.supports_requisition_parse then
    return jsonb_build_object('status', 'provider_unsupported');
  end if;
  select * into sourcing_catalog
    from public.ai_provider_catalog catalog
   where catalog.provider_slug = p_sourcing_provider_slug;
  if not found or not sourcing_catalog.supports_sourcing then
    return jsonb_build_object('status', 'provider_unsupported');
  end if;

  perform 1
    from public.api_keys key_row
   where key_row.id in (p_parse_api_key_id, p_sourcing_api_key_id)
   order by key_row.id
   for share;
  if not exists (
    select 1 from public.api_keys key_row
     where key_row.id = p_parse_api_key_id
       and key_row.workspace_id = caller_workspace
       and key_row.provider = parse_catalog.credential_provider
       and public.ai_execution_credential_verified(
         key_row.provider,
         key_row.status,
         key_row.last_tested_at,
         key_row.verification_method,
         key_row.verification_http_status
       )
  ) or not exists (
    select 1 from public.api_keys key_row
     where key_row.id = p_sourcing_api_key_id
       and key_row.workspace_id = caller_workspace
       and key_row.provider = sourcing_catalog.credential_provider
       and public.ai_execution_credential_verified(
         key_row.provider,
         key_row.status,
         key_row.last_tested_at,
         key_row.verification_method,
         key_row.verification_http_status
       )
  ) then
    return jsonb_build_object('status', 'credential_unavailable');
  end if;
  if not public.ai_runtime_model_evidence_matches(
    p_parse_model_evidence_id,
    caller_workspace,
    p_parse_api_key_id,
    parse_catalog.provider_slug,
    parse_catalog.credential_provider,
    parse_catalog.endpoint_profile,
    parse_catalog.catalog_revision,
    p_parse_model_name,
    'requisition_parse',
    true
  ) or not public.ai_runtime_model_evidence_matches(
    p_sourcing_model_evidence_id,
    caller_workspace,
    p_sourcing_api_key_id,
    sourcing_catalog.provider_slug,
    sourcing_catalog.credential_provider,
    sourcing_catalog.endpoint_profile,
    sourcing_catalog.catalog_revision,
    p_sourcing_model_name,
    'sourcing',
    true
  ) then
    return jsonb_build_object('status', 'model_evidence_unavailable');
  end if;

  binding_set_id := gen_random_uuid();
  parse_binding_id := gen_random_uuid();
  sourcing_binding_id := gen_random_uuid();
  parse_config_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.ai-runtime-binding.v1', caller_workspace::text, 'requisition_parse',
    parse_binding_id::text, parse_catalog.provider_slug,
    parse_catalog.credential_provider, parse_catalog.endpoint_profile,
    p_parse_model_name, p_parse_api_key_id::text,
    p_parse_model_evidence_id::text, parse_catalog.catalog_revision::text
  ), 'UTF8')), 'hex');
  sourcing_config_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.ai-runtime-binding.v1', caller_workspace::text, 'sourcing',
    sourcing_binding_id::text, sourcing_catalog.provider_slug,
    sourcing_catalog.credential_provider, sourcing_catalog.endpoint_profile,
    p_sourcing_model_name, p_sourcing_api_key_id::text,
    p_sourcing_model_evidence_id::text, sourcing_catalog.catalog_revision::text
  ), 'UTF8')), 'hex');
  binding_set_hash := encode(sha256(convert_to(concat_ws(E'\n',
    'aria.ai-runtime-binding-set.v1', caller_workspace::text, binding_set_id::text,
    request_hash, parse_config_hash, sourcing_config_hash
  ), 'UTF8')), 'hex');

  insert into public.ai_runtime_binding_sets (
    id, workspace_id, proposed_by, idempotency_key, request_sha256, set_sha256
  ) values (
    binding_set_id, caller_workspace, caller_id, p_idempotency_key,
    request_hash, binding_set_hash
  );
  insert into public.ai_runtime_bindings (
    id, binding_set_id, workspace_id, purpose, provider_slug,
    credential_provider, endpoint_profile, catalog_revision, model_name,
    api_key_id, proposal_model_evidence_id, config_sha256
  ) values
    (
      parse_binding_id, binding_set_id, caller_workspace, 'requisition_parse',
      parse_catalog.provider_slug, parse_catalog.credential_provider,
      parse_catalog.endpoint_profile, parse_catalog.catalog_revision,
      p_parse_model_name, p_parse_api_key_id, p_parse_model_evidence_id,
      parse_config_hash
    ),
    (
      sourcing_binding_id, binding_set_id, caller_workspace, 'sourcing',
      sourcing_catalog.provider_slug, sourcing_catalog.credential_provider,
      sourcing_catalog.endpoint_profile, sourcing_catalog.catalog_revision,
      p_sourcing_model_name, p_sourcing_api_key_id,
      p_sourcing_model_evidence_id, sourcing_config_hash
    );
  staged_receipt := public.insert_ai_runtime_binding_receipt(
    p_workspace_id => caller_workspace,
    p_binding_set_id => binding_set_id,
    p_idempotency_key => p_idempotency_key,
    p_event_type => 'staged',
    p_actor_id => caller_id,
    p_related_binding_set_id => null,
    p_set_sha256 => binding_set_hash
  );

  return jsonb_build_object(
    'status', 'staged',
    'replay', false,
    'binding_set_id', binding_set_id,
    'set_sha256', binding_set_hash,
    'receipt_sha256', staged_receipt.receipt_sha256
  );
end;
$$;

create or replace function public.activate_ai_runtime_binding_set(
  p_binding_set_id uuid,
  p_idempotency_key uuid,
  p_parse_model_evidence_id uuid,
  p_sourcing_model_evidence_id uuid,
  p_expected_workspace_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  caller_id uuid := auth.uid();
  target_set public.ai_runtime_binding_sets%rowtype;
  prior_active public.ai_runtime_binding_sets%rowtype;
  replay_receipt public.ai_runtime_binding_receipts%rowtype;
  activated_receipt public.ai_runtime_binding_receipts%rowtype;
  activation_at timestamptz := clock_timestamp();
  prior_active_found boolean := false;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if p_expected_workspace_id is null
     or caller_workspace is distinct from p_expected_workspace_id then
    return jsonb_build_object('status', 'workspace_conflict');
  end if;
  perform 1
    from public.profiles reviewer
   where reviewer.id = caller_id
     and reviewer.workspace_id = caller_workspace
     and reviewer.role = 'admin'
   for share;
  if not found then
    raise exception 'workspace reviewer administrator required' using errcode = '42501';
  end if;
  if p_binding_set_id is null
     or p_idempotency_key is null
     or p_parse_model_evidence_id is null
     or p_sourcing_model_evidence_id is null
     or p_parse_model_evidence_id = p_sourcing_model_evidence_id then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock_shared(550055202607210055::bigint);
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.ai-runtime-binding-workspace.v1' || E'\n' || caller_workspace::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'aria.ai-runtime-binding-activate.v1' || E'\n' || caller_workspace::text,
    0
  ));

  select * into replay_receipt
    from public.ai_runtime_binding_receipts receipt
   where receipt.workspace_id = caller_workspace
     and receipt.idempotency_key = p_idempotency_key
     and receipt.event_type = 'activated'
   for share;
  if found then
    if replay_receipt.binding_set_id <> p_binding_set_id
       or replay_receipt.actor_id <> caller_id then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'activated',
      'replay', true,
      'binding_set_id', replay_receipt.binding_set_id,
      'set_sha256', replay_receipt.set_sha256,
      'receipt_sha256', replay_receipt.receipt_sha256
    );
  end if;
  if exists (
    select 1 from public.ai_runtime_binding_receipts receipt
     where receipt.workspace_id = caller_workspace
       and receipt.idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  select * into target_set
    from public.ai_runtime_binding_sets binding_set
   where binding_set.id = p_binding_set_id
     and binding_set.workspace_id = caller_workspace
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if caller_id = target_set.proposed_by then
    return jsonb_build_object('status', 'independent_reviewer_required');
  end if;
  if target_set.status <> 'staged' then
    return jsonb_build_object('status', 'authority_invalid');
  end if;
  if not public.ai_runtime_binding_set_structurally_valid(target_set.id, caller_workspace) then
    return jsonb_build_object('status', 'authority_invalid');
  end if;
  if exists (
    select 1
     from public.ai_runtime_bindings binding
     where binding.binding_set_id = target_set.id
       and binding.workspace_id = caller_workspace
       and not exists (
         select 1
           from public.api_keys key_row
          where key_row.id = binding.api_key_id
            and key_row.workspace_id = binding.workspace_id
            and key_row.provider = binding.credential_provider
            and public.ai_execution_credential_verified(
              key_row.provider,
              key_row.status,
              key_row.last_tested_at,
              key_row.verification_method,
              key_row.verification_http_status
            )
       )
  ) then
    return jsonb_build_object('status', 'credential_unavailable');
  end if;
  if not exists (
    select 1
      from public.ai_runtime_bindings binding
     where binding.binding_set_id = target_set.id
       and binding.workspace_id = caller_workspace
       and binding.purpose = 'requisition_parse'
       and binding.proposal_model_evidence_id <> p_parse_model_evidence_id
       and public.ai_runtime_model_evidence_matches(
         p_parse_model_evidence_id,
         binding.workspace_id,
         binding.api_key_id,
         binding.provider_slug,
         binding.credential_provider,
         binding.endpoint_profile,
         binding.catalog_revision,
         binding.model_name,
         'requisition_parse',
         true
       )
  ) or not exists (
    select 1
      from public.ai_runtime_bindings binding
     where binding.binding_set_id = target_set.id
       and binding.workspace_id = caller_workspace
       and binding.purpose = 'sourcing'
       and binding.proposal_model_evidence_id <> p_sourcing_model_evidence_id
       and public.ai_runtime_model_evidence_matches(
         p_sourcing_model_evidence_id,
         binding.workspace_id,
         binding.api_key_id,
         binding.provider_slug,
         binding.credential_provider,
         binding.endpoint_profile,
         binding.catalog_revision,
         binding.model_name,
         'sourcing',
         true
       )
  ) then
    return jsonb_build_object('status', 'model_evidence_unavailable');
  end if;

  select * into prior_active
    from public.ai_runtime_binding_sets binding_set
   where binding_set.workspace_id = caller_workspace
     and binding_set.status = 'active'
     and binding_set.id <> target_set.id
   for update;
  prior_active_found := found;

  perform set_config('aria.ai_runtime_binding_evidence_authorized', '0055', true);
  update public.ai_runtime_bindings
     set activation_model_evidence_id = case purpose
       when 'requisition_parse' then p_parse_model_evidence_id
       when 'sourcing' then p_sourcing_model_evidence_id
       else null
     end
   where binding_set_id = target_set.id
     and workspace_id = caller_workspace;

  perform set_config('aria.ai_runtime_binding_lifecycle_authorized', '0055', true);
  if prior_active_found then
    update public.ai_runtime_binding_sets
       set status = 'superseded',
           superseded_at = activation_at,
           superseded_by_set_id = target_set.id
     where id = prior_active.id;
    perform public.insert_ai_runtime_binding_receipt(
      p_workspace_id => caller_workspace,
      p_binding_set_id => prior_active.id,
      p_idempotency_key => p_idempotency_key,
      p_event_type => 'superseded',
      p_actor_id => caller_id,
      p_related_binding_set_id => target_set.id,
      p_set_sha256 => prior_active.set_sha256
    );
  end if;

  update public.ai_runtime_binding_sets
     set status = 'active',
         reviewed_by = caller_id,
         reviewed_at = activation_at,
         activated_at = activation_at
   where id = target_set.id;
  activated_receipt := public.insert_ai_runtime_binding_receipt(
    p_workspace_id => caller_workspace,
    p_binding_set_id => target_set.id,
    p_idempotency_key => p_idempotency_key,
    p_event_type => 'activated',
    p_actor_id => caller_id,
    p_related_binding_set_id => case when prior_active_found then prior_active.id else null end,
    p_set_sha256 => target_set.set_sha256
  );

  return jsonb_build_object(
    'status', 'activated',
    'replay', false,
    'binding_set_id', target_set.id,
    'set_sha256', target_set.set_sha256,
    'receipt_sha256', activated_receipt.receipt_sha256
  );
end;
$$;

create or replace function public.resolve_active_ai_runtime_binding(
  p_workspace_id uuid,
  p_purpose text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  active_set public.ai_runtime_binding_sets%rowtype;
  requested_binding public.ai_runtime_bindings%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  if p_purpose is null or p_purpose not in ('requisition_parse', 'sourcing') then
    return jsonb_build_object('status', 'invalid_purpose');
  end if;

  perform pg_advisory_xact_lock_shared(550055202607210055::bigint);
  select * into active_set
    from public.ai_runtime_binding_sets binding_set
   where binding_set.workspace_id = p_workspace_id
     and binding_set.status = 'active'
   for share;
  if not found then
    return jsonb_build_object('status', 'not_configured');
  end if;
  if not public.ai_runtime_binding_set_structurally_valid(active_set.id, p_workspace_id) then
    return jsonb_build_object('status', 'authority_invalid');
  end if;
  if exists (
    select 1
      from public.ai_runtime_bindings binding
     where binding.binding_set_id = active_set.id
       and binding.workspace_id = p_workspace_id
       and not exists (
         select 1
           from public.api_keys key_row
          where key_row.id = binding.api_key_id
            and key_row.workspace_id = binding.workspace_id
            and key_row.provider = binding.credential_provider
            and public.ai_execution_credential_verified(
              key_row.provider,
              key_row.status,
              key_row.last_tested_at,
              key_row.verification_method,
              key_row.verification_http_status
            )
       )
  ) then
    return jsonb_build_object('status', 'credential_unavailable');
  end if;

  select * into requested_binding
    from public.ai_runtime_bindings binding
   where binding.binding_set_id = active_set.id
     and binding.workspace_id = p_workspace_id
     and binding.purpose = p_purpose;
  if not found then
    return jsonb_build_object('status', 'authority_invalid');
  end if;

  return jsonb_build_object(
    'status', 'configured',
    'workspace_id', p_workspace_id,
    'binding_set_id', active_set.id,
    'set_sha256', active_set.set_sha256,
    'binding_id', requested_binding.id,
    'purpose', requested_binding.purpose,
    'provider_slug', requested_binding.provider_slug,
    'credential_provider', requested_binding.credential_provider,
    'endpoint_profile', requested_binding.endpoint_profile,
    'model_name', requested_binding.model_name,
    'api_key_id', requested_binding.api_key_id,
    'catalog_revision', requested_binding.catalog_revision,
    'config_sha256', requested_binding.config_sha256
  );
end;
$$;

alter function public.stage_ai_runtime_binding_set(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid)
  owner to postgres;
alter function public.activate_ai_runtime_binding_set(uuid, uuid, uuid, uuid, uuid)
  owner to postgres;
alter function public.resolve_active_ai_runtime_binding(uuid, text) owner to postgres;

revoke all on function public.stage_ai_runtime_binding_set(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.stage_ai_runtime_binding_set(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid) to authenticated;
revoke all on function public.activate_ai_runtime_binding_set(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.activate_ai_runtime_binding_set(uuid, uuid, uuid, uuid, uuid) to authenticated;
revoke all on function public.resolve_active_ai_runtime_binding(uuid, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.resolve_active_ai_runtime_binding(uuid, text) to service_role;
