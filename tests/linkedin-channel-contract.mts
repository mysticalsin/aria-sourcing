import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  getLinkedInAdapter,
  linkedInAdapterForProvider,
  linkedInBackendForProvider,
} from "../src/lib/linkedin-channel";

const migration = readFileSync("supabase/migrations/0054_linkedin_channel_adapter_authority.sql", "utf8");
const whatsappMigration = readFileSync("supabase/migrations/0013_outreach_approval_race_safety.sql", "utf8");
const emailMigration = readFileSync("supabase/migrations/0039_email_channel_durability.sql", "utf8");
const dispatch = readFileSync("src/lib/dispatch-outbound.ts", "utf8");
const priv = readFileSync("tests/db/function-privileges.sql", "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function functionBlock(source: string, name: string): string {
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`, "i"));
  if (!match) throw new Error(`Missing function block: ${name}`);
  return match[0].replace(/\r\n/g, "\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

ok(
  "LinkedIn has a separate channel-guarded approval trigger function",
  /create or replace function public\.enforce_active_linkedin_approval\(\)/i.test(migration) &&
    /new\.channel <> 'LinkedIn' or old\.status <> 'queued' or new\.status <> 'dispatching'/i.test(migration) &&
    /create trigger messages_outbound_active_linkedin_approval[\s\S]*execute function public\.enforce_active_linkedin_approval\(\)/i.test(migration),
);
ok(
  "0054 does not replace Email or WhatsApp approval triggers",
  !/create or replace function public\.enforce_active_email_approval\(\)/i.test(migration) &&
    !/create or replace function public\.enforce_active_whatsapp_approval\(\)/i.test(migration),
);
ok(
  "WhatsApp approval trigger body stayed byte-identical",
  sha256(functionBlock(whatsappMigration, "enforce_active_whatsapp_approval")) ===
    "a29527e849df4109e05c349823b297954626bf6a45c7277549210716995cd700",
);
ok(
  "Email approval trigger body stayed byte-identical",
  sha256(functionBlock(emailMigration, "enforce_active_email_approval")) ===
    "6f29521257debcd1f8cebf50f1d7fb2e50dba4929dd814b6de68b0e2acb11203",
);
ok(
  "LinkedIn claim reuses approval hash, scope hash, suppression, contact window, and cap before ledger insert",
  /create or replace function public\.claim_linkedin_outbound_queued\(p_message_id uuid\)/i.test(migration) &&
    /approval\.body_hash is distinct from encode\(digest\(coalesce\(outbound\.subject, ''\) \|\| E'\\n' \|\| outbound\.body, 'sha256'\), 'hex'\)/i.test(migration) &&
    /approval\.approval_scope_hash is distinct from encode\(digest\(outbound\.candidate_id \|\| E'\\n' \|\| outbound\.channel \|\| E'\\n' \|\| recipient, 'sha256'\), 'hex'\)/i.test(migration) &&
    /s\.type = 'linkedin'/i.test(migration) &&
    /l\.status in \('claimed', 'sent', 'ambiguous'\)[\s\S]*interval '90 days'/i.test(migration) &&
    /used_today >= cap/i.test(migration) &&
    /insert into public\.outreach_ledger\(/i.test(migration),
);
ok(
  "LinkedIn outcome records into the shared ledger",
  /create or replace function public\.record_linkedin_delivery_outcome\(/i.test(migration) &&
    /from public\.outreach_ledger l[\s\S]*outbound_message_id = outbound\.id[\s\S]*send_attempt_id = p_delivery_attempt_id[\s\S]*for update/i.test(migration) &&
    /update public\.outreach_ledger[\s\S]*set status = next_ledger_status/i.test(migration),
);
ok(
  "LinkedIn authority functions are service-role only in the privilege proof",
  /public\.claim_linkedin_outbound_queued\(uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.record_linkedin_delivery_outcome\(uuid,uuid,text,text,text\)'\s*,\s*'service_role'/i.test(priv),
);
ok(
  "dispatcher routes LinkedIn through the adapter claim before backend delivery",
  dispatch.indexOf('msg.channel === "LinkedIn"') >= 0 &&
    dispatch.indexOf('rpc("claim_linkedin_outbound_queued"') > dispatch.indexOf('msg.channel === "LinkedIn"') &&
    dispatch.indexOf("await adapter.deliver") > dispatch.indexOf('rpc("claim_linkedin_outbound_queued"') &&
    dispatch.indexOf('rpc("record_linkedin_delivery_outcome"') > dispatch.indexOf("await adapter.deliver"),
);
ok(
  "dispatcher fails dark vendor credentials before claim or delivery",
  dispatch.indexOf("!adapter.configured()") > dispatch.indexOf('msg.channel === "LinkedIn"') &&
    dispatch.indexOf("!adapter.configured()") < dispatch.indexOf('rpc("claim_linkedin_outbound_queued"') &&
    /linkedin-provider-unconfigured/.test(dispatch),
);
ok("adapter maps assisted-manual by provider", linkedInBackendForProvider("LinkedIn Assisted Manual") === "assisted-manual");
ok("adapter maps vendor-api by provider", linkedInBackendForProvider("LinkedIn Vendor API") === "vendor-api");
ok("adapter maps heyreach by provider", linkedInBackendForProvider("HeyReach") === "heyreach");
ok("unknown provider has no adapter", linkedInAdapterForProvider("LinkedIn Bot Fleet") === null);

const originalUrl = process.env.LINKEDIN_VENDOR_API_URL;
const originalKey = process.env.LINKEDIN_VENDOR_API_KEY;
delete process.env.LINKEDIN_VENDOR_API_URL;
delete process.env.LINKEDIN_VENDOR_API_KEY;
try {
  const vendor = getLinkedInAdapter("vendor-api");
  ok("vendor adapter reports unconfigured without credentials", vendor.configured() === false);
  const result = await vendor.deliver({
    workspaceId: "ws-1",
    messageId: "m-1",
    candidateId: "cand-1",
    profileUrl: "https://www.linkedin.com/in/marco-rossi",
    subject: "Quick note",
    body: "Hello",
    attemptId: "11111111-1111-4111-8111-111111111111",
  });
  ok(
    "vendor adapter fails closed without credentials",
    result.status === "error" &&
      result.deliveryState === "not-sent" &&
      /not set/i.test(result.detail),
  );
} finally {
  if (originalUrl === undefined) delete process.env.LINKEDIN_VENDOR_API_URL;
  else process.env.LINKEDIN_VENDOR_API_URL = originalUrl;
  if (originalKey === undefined) delete process.env.LINKEDIN_VENDOR_API_KEY;
  else process.env.LINKEDIN_VENDOR_API_KEY = originalKey;
}

console.log(`RESULT linkedin-channel-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
