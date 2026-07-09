-- Atomic terminal transition for a WhatsApp attempt that the provider
-- definitively rejected. Unknown acceptance remains dispatching and is
-- resolved by the provider-acceptance or delivery-event reconciliation paths.

create or replace function public.finalize_whatsapp_provider_failure(
  p_message_id uuid,
  p_delivery_attempt_id uuid,
  p_reason text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  outbound public.messages_outbound%rowtype;
  ledger public.outreach_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_delivery_attempt_id is null then
    return json_build_object('allowed', false, 'reason', 'invalid-delivery-attempt');
  end if;
  if p_reason is null or length(btrim(p_reason)) < 1 or length(p_reason) > 512 then
    return json_build_object('allowed', false, 'reason', 'invalid-reason');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'WhatsApp' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;
  if outbound.status <> 'dispatching' then
    return json_build_object('allowed', false, 'reason', 'not-dispatching');
  end if;

  select * into ledger
    from public.outreach_ledger
    where workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
    for update;
  if not found or ledger.status <> 'claimed' then
    return json_build_object('allowed', false, 'reason', 'ledger-not-claimed');
  end if;

  update public.messages_outbound
    set status = 'failed'
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;
  if not found then raise exception 'outbox ownership changed during WhatsApp failure finalization'; end if;

  update public.outreach_ledger
    set status = 'skipped',
        reason = p_reason
    where id = ledger.id
      and workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
      and status = 'claimed';
  if not found then raise exception 'ledger ownership changed during WhatsApp failure finalization'; end if;

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

revoke all on function public.finalize_whatsapp_provider_failure(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_whatsapp_provider_failure(uuid, uuid, text) to service_role;
