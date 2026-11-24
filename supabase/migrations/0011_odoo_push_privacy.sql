-- ARIA <-> Odoo, second step (docs/odoo.md, ADR 0003).
--
-- 1. Live updates: Odoo calls ARIA when a handed-off applicant changes stage
--    (an Odoo automation rule "send webhook notification"). Odoo cannot sign
--    its calls, so the webhook URL carries a random token; only its SHA-256 is
--    stored. The call is a ping: ARIA reads the applicant back from Odoo with
--    its own key and never trusts the payload.
-- 2. Erasure: erasing a candidate in ARIA also erases the Odoo applicant ARIA
--    created (unless hired: the employee record follows HR retention).
--    odoo_erasures is the receipt, and the queue for retries.
-- 3. odoo_candidate_record() also returns what the server needs to refuse a
--    hand-off of a confidential profile nobody revealed.

alter table public.odoo_connections
  add column webhook_token_hash text unique check (webhook_token_hash ~ '^[0-9a-f]{64}$'),
  add column webhook_url_base text check (webhook_url_base is null or (webhook_url_base ~ '^https?://[^\s?#]+$' and char_length(webhook_url_base) <= 300)),
  add column webhook_automation_id integer check (webhook_automation_id > 0),
  add column webhook_created_at timestamptz,
  add column last_webhook_at timestamptz,
  add constraint odoo_connections_webhook_check
    check ((webhook_token_hash is null) = (webhook_created_at is null));

create index odoo_applicant_links_applicant
  on public.odoo_applicant_links(workspace_id, applicant_id) where state = 'linked';

create table public.odoo_erasures (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id text not null check (char_length(candidate_id) between 1 and 120),
  request_id uuid,
  applicant_id integer not null check (applicant_id > 0),
  -- pending: Odoo not reached yet (retry); deleted: applicant (and its own
  -- contact) deleted; kept_hired: hired, HR decides; failed: Odoo refused.
  status text not null check (status in ('pending', 'deleted', 'kept_hired', 'failed')),
  detail text check (char_length(detail) <= 500),
  attempts integer not null default 0 check (attempts between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, candidate_id),
  check ((status in ('deleted', 'kept_hired')) = (completed_at is not null))
);

alter table public.odoo_erasures enable row level security;
alter table public.odoo_erasures force row level security;
revoke all on public.odoo_erasures from public, anon, authenticated, authenticator;
grant select, insert, update, delete on public.odoo_erasures to service_role;
create policy odoo_erasures_owner on public.odoo_erasures to postgres, supabase_admin using (true) with check (true);

create or replace function public.odoo_candidate_record(p_workspace_id uuid, p_candidate_id text)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
           'candidate', c,
           'campaignTitle', (
             select camp->>'title'
               from jsonb_array_elements(coalesce(ws.state->'campaigns', '[]'::jsonb)) camp
              where camp->>'id' = c->>'campaignId'
              limit 1
           ),
           'confidentialityMode', coalesce(ws.state->'settings'->'confidentialityMode' = 'true'::jsonb, false),
           'lastRevealAt', (
             select max(a->>'createdAt')
               from jsonb_array_elements(coalesce(ws.state->'activities', '[]'::jsonb)) a
              where a->>'linkedEntityId' = p_candidate_id
                and a->>'title' = 'Candidate PII revealed'
           )
         )
    from public.workspace_state ws,
         jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) c
   where ws.workspace_id = p_workspace_id
     and c->>'id' = p_candidate_id
   limit 1
$$;
revoke all on function public.odoo_candidate_record(uuid, text) from public, anon, authenticated;
grant execute on function public.odoo_candidate_record(uuid, text) to service_role;
