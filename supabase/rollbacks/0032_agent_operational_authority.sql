-- Source-tested, partial application-surface fallback for the 0032 executable
-- surfaces. This file is NOT production-executable until a protected apply job
-- and an append-only, ledger-safe forward migration are reviewed and shipped.
-- See the runbook. The disposable DB gate proves behavior only.
-- This is not a database-schema rollback. Additive audit schema,
-- immutable framework-memory receipts, and exact workspace/seat constraints
-- are intentionally retained. Removing them would destroy evidence or reopen a
-- cross-tenant binding defect and is not a safe production rollback.

do $complete_agent_framework_run_v0029_restore$
begin
  if to_regprocedure(
       'public.complete_agent_framework_run_v0029(uuid,uuid,text,text,integer,text)'
     ) is not null then
    drop function if exists public.complete_agent_framework_run(
      uuid, uuid, text, text, integer, text, jsonb
    );
    alter function public.complete_agent_framework_run_v0029(
      uuid, uuid, text, text, integer, text
    ) rename to complete_agent_framework_run;
  end if;
end
$complete_agent_framework_run_v0029_restore$;
grant execute on function public.complete_agent_framework_run(
  uuid, uuid, text, text, integer, text
) to service_role;

-- Direct service-role memory writes and sequence use stay revoked. The retained
-- 0025 run RPC is SECURITY DEFINER and continues to create its governed receipt
-- and event; memory-management mutations and runtime egress leases are
-- unavailable after this rollback. Content-free historical lease rows remain
-- as operational evidence.

do $claim_agent_framework_run_v0029_restore$
begin
  if to_regprocedure(
       'public.claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text)'
     ) is not null then
    drop function if exists public.claim_agent_framework_run(
      uuid, uuid, uuid, uuid, text, text, uuid, text, text
    );
    alter function public.claim_agent_framework_run_v0029(
      uuid, uuid, uuid, uuid, text, text, uuid, text, text
    ) rename to claim_agent_framework_run;
  end if;
end
$claim_agent_framework_run_v0029_restore$;
grant execute on function public.claim_agent_framework_run(
  uuid, uuid, uuid, uuid, text, text, uuid, text, text
) to service_role;

drop function if exists public.release_agent_framework_memory_egress(
  uuid, uuid, uuid
);
drop function if exists public.authorize_agent_framework_memory_egress(
  uuid, uuid
);
drop function if exists public.attach_agent_framework_run_memory_context(
  uuid, uuid, uuid, uuid, uuid
);
drop function if exists public.delete_agent_memory_content(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, integer
);
drop function if exists public.mutate_agent_memory(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz
);
drop function if exists public.create_agent_memory(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz
);

-- Deliberately retained after rollback:
--   * agent_framework_run_memory_context, memory_context_attached_at, and
--     bounded proposal_reports
--   * agent_framework_memory_egress_leases historical content-free evidence
--   * agent_memory_events.framework_run_id and its exact-scope constraints
--   * all four composite workspace/seat foreign keys
--   * opaque email-connection quarantine receipts
