-- 0063 is intentionally non-reversible.
--
-- Its predecessor could automatically schedule LinkedIn work. Reintroducing
-- that behavior would weaken a permanent safety boundary. Apply a reviewed
-- forward migration to correct 0063; never run a downgrade that restores the
-- predecessor's implementation.
do $$
begin
  raise exception
    '0063 rollback is intentionally unsupported: it would weaken the permanent LinkedIn manual-only safety boundary'
    using errcode = '55000';
end;
$$;
