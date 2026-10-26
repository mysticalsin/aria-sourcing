import { readFileSync } from "node:fs";

import { loadBaselineSchema } from "./lib/baseline-schema.mts";

const migration = readFileSync("supabase/migrations/0001_baseline.sql", "utf8");
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
  /auth\.role\(\)[\s\S]*?service_role/.test(loadBaselineSchema().fn("finalize_email_provider_failure")) &&
    JSON.stringify(loadBaselineSchema().functionGrantees("finalize_email_provider_failure")) === JSON.stringify(["service_role"]),
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

console.log(`RESULT dispatch-concurrency: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
