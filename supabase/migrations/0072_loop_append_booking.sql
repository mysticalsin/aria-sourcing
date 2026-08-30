-- 0072_loop_append_booking.sql
-- Allow the loop worker to persist confirmed Teams bookings into state.bookings
-- (Calendar Agenda / useBookings) after confirm-calendar-book succeeds.
-- Candidate.booking remains via merge_candidate_patch; this append mirrors
-- createBookingFor so KPI/calendar surfaces stay honest.

create or replace function public.apply_workspace_patch(
  p_workspace_id uuid,
  p_expected_updated_at timestamptz,
  p_patch_kind text,
  p_patch jsonb,
  p_receipt_key text
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  ws public.workspace_state%rowtype;
  receipt public.workspace_patch_receipts%rowtype;
  sha text;
  new_state jsonb;
  payload text;
  append_kinds constant text[] := array[
    'append_campaign', 'append_candidates', 'append_activities', 'append_reply',
    'append_enrichment_ledger', 'append_outreach', 'append_booking'];
  append_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_patch_kind is null or p_patch_kind not in (
      'append_campaign', 'append_candidates', 'append_activities', 'append_reply',
      'append_enrichment_ledger', 'append_outreach', 'append_booking',
      'merge_candidate_patch', 'merge_outreach_status') then
    return json_build_object('status', 'invalid_request', 'reason', 'unknown-patch-kind');
  end if;
  if p_patch is null then
    return json_build_object('status', 'invalid_request', 'reason', 'null-patch');
  end if;
  if p_receipt_key is null or char_length(btrim(p_receipt_key)) < 1 or char_length(p_receipt_key) > 200 then
    return json_build_object('status', 'invalid_request', 'reason', 'invalid-receipt-key');
  end if;

  payload := p_patch_kind || E'\n' || p_patch::text;
  begin
    sha := encode(public.digest(convert_to(payload, 'UTF8'), 'sha256'::text), 'hex');
  exception
    when undefined_function then
      begin
        sha := encode(extensions.digest(convert_to(payload, 'UTF8'), 'sha256'::text), 'hex');
      exception
        when undefined_function then
          sha := md5(payload) || md5(reverse(payload));
      end;
  end;

  select * into ws
    from public.workspace_state
    where workspace_id = p_workspace_id
    for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if p_expected_updated_at is distinct from ws.updated_at then
    return json_build_object('status', 'stale_token');
  end if;

  select * into receipt
    from public.workspace_patch_receipts
   where workspace_id = p_workspace_id
     and receipt_key = p_receipt_key;
  if found then
    if receipt.patch_kind = p_patch_kind and receipt.patch_sha256 = sha then
      return json_build_object('status', 'already_applied');
    end if;
    return json_build_object('status', 'idempotency_conflict');
  end if;

  new_state := ws.state;
  if p_patch_kind = any(append_kinds) then
    if jsonb_typeof(p_patch) <> 'array' then
      return json_build_object('status', 'invalid_request', 'reason', 'append-expects-array');
    end if;
    append_key := case p_patch_kind
      when 'append_campaign' then 'campaigns'
      when 'append_candidates' then 'candidates'
      when 'append_activities' then 'activities'
      when 'append_reply' then 'replies'
      when 'append_enrichment_ledger' then 'enrichmentLedger'
      when 'append_outreach' then 'outreach'
      when 'append_booking' then 'bookings'
    end;
    new_state := jsonb_set(
      new_state,
      array[append_key],
      coalesce(new_state->append_key, '[]'::jsonb) || p_patch,
      true);

  elsif p_patch_kind = 'merge_candidate_patch' then
    if p_patch->>'id' is null or p_patch->'patch' is null then
      return json_build_object('status', 'invalid_request', 'reason', 'merge-candidate-shape');
    end if;
    new_state := jsonb_set(
      ws.state,
      '{candidates}',
      coalesce((
        select jsonb_agg(
          case when elem->>'id' = p_patch->>'id'
                and (p_patch->>'campaignId' is null or elem->>'campaignId' = p_patch->>'campaignId')
               then elem || (p_patch->'patch')
               else elem end)
        from jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
      ), '[]'::jsonb),
      true);

  elsif p_patch_kind = 'merge_outreach_status' then
    if p_patch->>'candidateId' is null or p_patch->'patch' is null then
      return json_build_object('status', 'invalid_request', 'reason', 'merge-outreach-shape');
    end if;
    new_state := jsonb_set(
      ws.state,
      '{candidates}',
      coalesce((
        select jsonb_agg(
          case when elem->>'id' = p_patch->>'candidateId'
               then elem || (p_patch->'patch')
               else elem end)
        from jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
      ), '[]'::jsonb),
      true);
  end if;

  update public.workspace_state
     set state = new_state
   where workspace_id = p_workspace_id;

  insert into public.workspace_patch_receipts(workspace_id, receipt_key, patch_kind, patch_sha256)
  values (p_workspace_id, p_receipt_key, p_patch_kind, sha);

  return json_build_object('status', 'applied');
end;
$$;

revoke all on function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text)
  to service_role;

alter function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text) owner to postgres;
