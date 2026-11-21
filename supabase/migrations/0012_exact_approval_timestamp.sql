-- Bind the stored approval timestamp to the timestamp that exactBodyHash used.
-- The three-argument record_outreach_approval stays for existing grants. This
-- overload writes that same row, then replaces approved_at with the caller's
-- timestamp so the send path can recompute the hash.

CREATE FUNCTION public.record_outreach_approval(
  p_message_id text,
  p_body_hash text,
  p_approval_scope_hash text,
  p_approved_at timestamp with time zone
) RETURNS json
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  result json;
  wid uuid;
begin
  if p_approved_at is null
     or p_approved_at > now() + interval '5 minutes'
     or p_approved_at < now() - interval '5 minutes' then
    return json_build_object('ok', false, 'reason', 'approval-expired');
  end if;

  result := public.record_outreach_approval(p_message_id, p_body_hash, p_approval_scope_hash);
  if coalesce((result ->> 'ok')::boolean, false) is not true then
    return result;
  end if;

  wid := public.current_workspace_id();
  update public.outreach_approvals
     set approved_at = p_approved_at
   where workspace_id = wid
     and message_id = p_message_id
     and revoked_at is null;
  if not found then
    return json_build_object('ok', false, 'reason', 'approval-record-failed');
  end if;
  return result;
end;
$$;

REVOKE ALL ON FUNCTION public.record_outreach_approval(p_message_id text, p_body_hash text, p_approval_scope_hash text, p_approved_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_outreach_approval(p_message_id text, p_body_hash text, p_approval_scope_hash text, p_approved_at timestamp with time zone) TO authenticated;
