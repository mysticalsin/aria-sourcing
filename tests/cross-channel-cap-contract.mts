import { existsSync, readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/0024_cross_channel_claim_serialization.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function section(start: string, end?: string): string {
  const startAt = migration.indexOf(start);
  if (startAt < 0) return "";
  const endAt = end ? migration.indexOf(end, startAt + start.length) : migration.length;
  return migration.slice(startAt, endAt < 0 ? migration.length : endAt);
}

ok("append-only migration 0024 exists", migration.length > 0);

const generic = section(
  "create or replace function public.claim_and_record(",
  "create or replace function public.claim_whatsapp_outbound(",
);
const whatsapp = section("create or replace function public.claim_whatsapp_outbound(");

ok(
  "generic claim preserves the exact six-parameter signature",
  /create or replace function public\.claim_and_record\(\s*p_candidate_id\s+text,\s*p_candidate_email\s+text,\s*p_campaign_id\s+text,\s*p_seat_id\s+uuid,\s*p_channel\s+text default 'Email',\s*p_recontact_days\s+int\s+default 90\s*\) returns json/i.test(
    generic,
  ),
);
ok(
  "generic claim locks the workspace seat before counting and inserting",
  generic.indexOf("from public.agent_seats") >= 0 &&
    generic.indexOf("from public.agent_seats") < generic.indexOf("for update") &&
    generic.indexOf("for update") < generic.indexOf("count(*)") &&
    generic.indexOf("count(*)") < generic.indexOf("insert into public.outreach_ledger"),
);
ok(
  "generic claim counts worst-case ambiguous outcomes",
  /where seat_id = p_seat_id[\s\S]*?status in \('claimed','sent','ambiguous'\)/i.test(generic),
);
ok(
  "generic claim keeps its hardened definer boundary",
  /language plpgsql security definer set search_path = pg_catalog, public, pg_temp/i.test(generic),
);

ok(
  "WhatsApp claim preserves its exact UUID signature",
  /create or replace function public\.claim_whatsapp_outbound\(p_message_id uuid\)[\s\S]*?returns json/i.test(whatsapp),
);
ok(
  "WhatsApp claim keeps its in-body service-role assertion",
  /auth\.role\(\)[\s\S]*?<> 'service_role'[\s\S]*?'service-only'/i.test(whatsapp),
);
ok(
  "WhatsApp claim preserves approvals-before-seat lock order",
  whatsapp.indexOf("from public.messages_outbound") >= 0 &&
    whatsapp.indexOf("from public.messages_outbound") < whatsapp.indexOf("pg_advisory_xact_lock") &&
    whatsapp.indexOf("pg_advisory_xact_lock") < whatsapp.indexOf("from public.outreach_approvals") &&
    whatsapp.indexOf("from public.outreach_approvals") < whatsapp.indexOf("from public.agent_seats") &&
    whatsapp.indexOf("from public.agent_seats") < whatsapp.indexOf("count(*)") &&
    whatsapp.indexOf("count(*)") < whatsapp.indexOf("insert into public.outreach_ledger"),
);
ok(
  "WhatsApp claim takes the same workspace-scoped seat row lock",
  /from public\.agent_seats\s+where id = outbound\.seat_id and workspace_id = outbound\.workspace_id\s+for update/i.test(
    whatsapp,
  ),
);
ok(
  "WhatsApp claim counts worst-case ambiguous outcomes",
  /where l\.seat_id = seat\.id[\s\S]*?l\.status in \('claimed', 'sent', 'ambiguous'\)/i.test(whatsapp),
);
ok(
  "WhatsApp claim keeps its hardened pgcrypto definer boundary",
  /language plpgsql[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog, public, extensions, pg_temp/i.test(
    whatsapp,
  ),
);

ok(
  "both direct claim RPCs remain service-role only",
  /revoke all on function public\.claim_and_record\(text,text,text,uuid,text,int\) from public, anon, authenticated, service_role, authenticator;/i.test(
    migration,
  ) &&
    /grant execute on function public\.claim_and_record\(text,text,text,uuid,text,int\) to service_role;/i.test(
      migration,
    ) &&
    /revoke all on function public\.claim_whatsapp_outbound\(uuid\) from public, anon, authenticated, service_role, authenticator;/i.test(
      migration,
    ) &&
    /grant execute on function public\.claim_whatsapp_outbound\(uuid\) to service_role;/i.test(migration) &&
    !/grant[^;]*(?:claim_and_record|claim_whatsapp_outbound)[^;]*to authenticated/i.test(migration),
);
ok(
  "migration leaves transaction ownership to the bootstrap runner",
  !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
);
ok(
  "migration changes no schema shape beyond replacing the two claim functions",
  !/create table|alter table|create index|drop index/i.test(migration) &&
    (migration.match(/create or replace function/gi) ?? []).length === 2,
);

console.log(`RESULT cross-channel-cap-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
