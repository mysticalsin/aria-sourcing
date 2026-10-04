-- 0047_email_delivery_events_service_role_select.sql
--
-- Repair the effective read privilege for email delivery receipts after 0039
-- revoked service_role table access. The service role writes through the
-- service-only RPC, but database proof and operational reconciliation also need
-- least-privilege SELECT parity with authenticated readers.

grant select on public.email_delivery_events to service_role;
