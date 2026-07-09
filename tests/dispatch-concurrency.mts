import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/0017_dispatch_concurrency.sql", "utf8");
const dispatcher = readFileSync("src/lib/dispatch-outbound.ts", "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok(
  "failure finalization is service-role only",
  /finalize_whatsapp_provider_failure[\s\S]*?auth\.role\(\)[\s\S]*?service_role[\s\S]*?revoke all[\s\S]*?authenticated[\s\S]*?grant execute[\s\S]*?service_role/i.test(migration),
);
ok(
  "failure finalization locks the outbox ownership row",
  /from public\.messages_outbound[\s\S]*?where id = p_message_id[\s\S]*?for update/i.test(migration),
);
ok(
  "failure finalization validates status and exact attempt",
  /delivery_attempt_id is distinct from p_delivery_attempt_id[\s\S]*?status <> 'dispatching'/i.test(migration),
);
ok(
  "failure finalization locks the matching ledger",
  /from public\.outreach_ledger[\s\S]*?workspace_id = outbound\.workspace_id[\s\S]*?outbound_message_id = outbound\.id[\s\S]*?for update/i.test(migration),
);
ok(
  "failure finalization compare-and-sets the outbox",
  /update public\.messages_outbound[\s\S]*?status = 'failed'[\s\S]*?status = 'dispatching'[\s\S]*?delivery_attempt_id = p_delivery_attempt_id/i.test(migration),
);
ok(
  "failure finalization releases only the claimed matching ledger",
  /update public\.outreach_ledger[\s\S]*?status = 'skipped'[\s\S]*?outbound_message_id = outbound\.id[\s\S]*?status = 'claimed'/i.test(migration),
);
ok(
  "dispatcher rejects a malformed attempt before the provider call",
  dispatcher.indexOf("UUID_PATTERN.test(deliveryAttemptId)") < dispatcher.indexOf("await sendWhatsApp"),
);
ok(
  "dispatcher routes proven failures through the atomic function",
  /outcome\.deliveryState !== "not-sent"[\s\S]*?finalize_whatsapp_provider_failure/.test(dispatcher),
);

console.log(`RESULT dispatch-concurrency: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
