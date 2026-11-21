\set ON_ERROR_STOP on

-- claim_email_outbound must refuse a missing or stale approved_at. This checks
-- the function that the migrations actually installed.
do $$
declare
  src text;
begin
  src := pg_get_functiondef('public.claim_email_outbound(text,text,text,text,text,text,uuid)'::regprocedure);
  if src !~ 'approved_at is null' then
    raise exception 'claim_email_outbound does not require approved_at';
  end if;
  if src !~ '7 days' then
    raise exception 'claim_email_outbound does not enforce the approval TTL';
  end if;
  if src !~ 'approval-expired' then
    raise exception 'claim_email_outbound does not refuse an expired approval';
  end if;
end $$;
