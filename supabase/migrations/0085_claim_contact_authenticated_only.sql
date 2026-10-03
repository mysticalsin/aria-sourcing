-- 0085: claim_contact / complete_contact_lease are member RPCs (auth.uid()).
-- 0063/0080 also granted service_role, which fails the reviewed privilege
-- matrix (authenticated only). service_role enqueue goes through
-- enqueue_linkedin_outbound (SECURITY DEFINER) and does not need direct
-- EXECUTE on these two functions.

revoke execute on function public.claim_contact(text, text, uuid, int)
  from service_role;

revoke execute on function public.complete_contact_lease(uuid, text, text)
  from service_role;
