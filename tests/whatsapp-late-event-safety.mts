import { existsSync, readFileSync } from "fs";
import {
  decideWhatsAppInboundDisposition,
  decideWhatsAppReceiptAcknowledgement,
  shouldReopenWhatsAppReview,
  canRecoverStoredWhatsAppInbound,
  isReviewableWhatsAppDraft,
} from "../src/lib/whatsapp-review-policy";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

// A signed opt-out always wins over a paused or revoked sender. The exact
// inbound event must be stored and processed so it writes both contact consent
// and the permanent phone suppression before any later reactivation.
for (const senderStatus of ["paused", "revoked"] as const) {
  const disposition = decideWhatsAppInboundDisposition({ senderStatus, isOptOut: true });
  ok(`${senderStatus} sender: STOP is durably stored`, disposition.store);
  ok(`${senderStatus} sender: STOP enters the deterministic opt-out processor`, disposition.process);
  ok(`${senderStatus} sender: STOP is not pre-marked processed`, disposition.initiallyProcessed === false);
}

// Other late inbound text is preserved for audit but intentionally cannot be
// recovered and drafted after an operator reactivates the sender.
for (const senderStatus of ["paused", "revoked"] as const) {
  const disposition = decideWhatsAppInboundDisposition({ senderStatus, isOptOut: false });
  ok(`${senderStatus} sender: non-opt-out is retained`, disposition.store);
  ok(`${senderStatus} sender: non-opt-out never enters the reply processor`, disposition.process === false);
  ok(`${senderStatus} sender: non-opt-out cannot become recoverable after reactivation`,
    canRecoverStoredWhatsAppInbound({ processed: disposition.initiallyProcessed, senderId: "sender-1" }) === false,
  );
}

{
  const disposition = decideWhatsAppInboundDisposition({ senderStatus: "active", isOptOut: false });
  ok("active sender: ordinary reply remains eligible for normal processing", disposition.store && disposition.process && !disposition.initiallyProcessed);
}

// The webhook must distinguish an explicit unknown receipt from a receipt
// that raced provider-acceptance persistence. Unknown signed provider events
// are harmless no-ops; an ambiguous known-sender receipt must be retried.
ok(
  "unknown sender receipt is acknowledged without a tenant retry loop",
  decideWhatsAppReceiptAcknowledgement({ senderKnown: false, rpcResult: null }).acknowledge === true,
);
ok(
  "recorded receipt is acknowledged",
  decideWhatsAppReceiptAcknowledgement({ senderKnown: true, rpcResult: { recorded: true, retryable: false, reason: "recorded" } }).acknowledge === true,
);
ok(
  "explicitly unknown provider receipt is acknowledged as unknown, not recorded",
  (() => {
    const decision = decideWhatsAppReceiptAcknowledgement({
      senderKnown: true,
      rpcResult: { recorded: false, retryable: false, reason: "unknown-provider-message" },
    });
    return decision.acknowledge === true && decision.reason === "unknown-provider-message";
  })(),
);
ok(
  "provider-acceptance race receipt is retryable",
  decideWhatsAppReceiptAcknowledgement({
    senderKnown: true,
    rpcResult: { recorded: false, retryable: true, reason: "awaiting-provider-acceptance" },
  }).acknowledge === false,
);
ok(
  "legacy or malformed false outcome fails closed instead of being acknowledged as persisted",
  decideWhatsAppReceiptAcknowledgement({
    senderKnown: true,
    rpcResult: { recorded: false, reason: "outbound-not-found" },
  }).acknowledge === false,
);

// A temporary delivery-policy failure after approval must reopen review, never
// orphan a blocked row whose prior decision makes the review RPC reject it.
ok(
  "an approved WhatsApp candidate reply reopens review after a transient block",
  shouldReopenWhatsAppReview({ channel: "WhatsApp", type: "candidate_reply", status: "blocked", reviewDecision: "approved" }),
);
ok(
  "a reopened WhatsApp reply is accepted by the existing review gate",
  isReviewableWhatsAppDraft({ channel: "WhatsApp", type: "candidate_reply", status: "blocked", reviewDecision: null }),
);
ok(
  "a rejected WhatsApp reply is not reopened by the dispatcher",
  !shouldReopenWhatsAppReview({ channel: "WhatsApp", type: "candidate_reply", status: "blocked", reviewDecision: "rejected" }),
);

const webhookRoute = readFileSync(new URL("../src/app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8");
const inboundProcessor = readFileSync(new URL("../src/lib/whatsapp-inbound.ts", import.meta.url), "utf8");
const dispatcher = readFileSync(new URL("../src/lib/dispatch-outbound.ts", import.meta.url), "utf8");
const migrationPath = new URL("../supabase/migrations/0015_whatsapp_webhook_late_event_safety.sql", import.meta.url);

ok("webhook persists an inactive-sender message with its disposition", /processed:\s*inboundDisposition\.initiallyProcessed/.test(webhookRoute));
{
  const inactiveDispositionIndex = webhookRoute.indexOf("if (!inboundDisposition.process)");
  const processorIndex = webhookRoute.indexOf("processStoredWhatsAppInbound", inactiveDispositionIndex);
  const continuationIndex = webhookRoute.indexOf("continue;", inactiveDispositionIndex);
  ok(
    "webhook sends only an eligible inactive-sender opt-out to the processor",
    inactiveDispositionIndex >= 0 && continuationIndex > inactiveDispositionIndex && processorIndex > continuationIndex,
  );
}
ok("webhook passes sender identity into receipt reconciliation", /p_sender_id:\s*sender\.id/.test(webhookRoute));
ok("webhook uses explicit receipt acknowledgement classification", /decideWhatsAppReceiptAcknowledgement/.test(webhookRoute));
ok("inbound recovery filters unmapped senders before its limit", /\.not\("whatsapp_sender_id",\s*"is",\s*null\)[\s\S]*?\.limit\(boundedLimit\)/.test(inboundProcessor));
ok("duplicate generated drafts are idempotent only when tied to the same inbound event", /outboundErr\?\.code === "23505"[\s\S]*?inbound_message_id[\s\S]*?input\.inboundId/.test(inboundProcessor));
ok("a different inbound draft collision is sent to durable triage", /review-draft-dedupe-conflict/.test(inboundProcessor));
ok("dispatcher clears an approved review decision when a candidate reply is re-blocked", /shouldReopenWhatsAppReview[\s\S]*?review_decision:\s*null[\s\S]*?reviewed_at:\s*null[\s\S]*?reviewed_by:\s*null/.test(dispatcher));

ok("late-event migration exists", existsSync(migrationPath));
if (existsSync(migrationPath)) {
  const migration = readFileSync(migrationPath, "utf8");
  ok("receipt RPC accepts the registered sender identity", /record_whatsapp_delivery_event\([\s\S]*?p_sender_id uuid/.test(migration));
  ok("receipt RPC returns an explicit retryable acceptance-race outcome", /awaiting-provider-acceptance/.test(migration) && /'retryable', true/.test(migration));
  ok("receipt RPC returns an explicit unknown receipt outcome", /unknown-provider-message/.test(migration) && /'retryable', false/.test(migration));
  ok("triage completion retains an operator-visible reason", /p_outcome in \('retry', 'triage'\)/.test(migration));
}

console.log(`RESULT whatsapp-late-event-safety: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
