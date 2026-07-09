import { createHmac } from "crypto";
import { readFileSync } from "fs";
import {
  verifyMetaSignature,
  parseWhatsAppWebhook,
  parseWhatsAppDeliveryStatuses,
  buildReplyPrompt,
  decideAutopilot,
} from "../src/lib/autopilot";
import { isWhatsAppOptOut } from "../src/lib/whatsapp-policy";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } }

// ---------------------------------------------------------------------------
// Meta signature verification
// ---------------------------------------------------------------------------
{
  const secret = "test-app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const good = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  ok("sig: valid signature passes", verifyMetaSignature(body, good, secret));
  ok("sig: wrong secret fails", !verifyMetaSignature(body, good, "other-secret"));
  ok("sig: tampered body fails", !verifyMetaSignature(body + "x", good, secret));
  ok("sig: missing header fails", !verifyMetaSignature(body, null, secret));
  ok("sig: empty secret fails", !verifyMetaSignature(body, good, ""));
  ok("sig: malformed header fails (no throw)", !verifyMetaSignature(body, "sha256=zz", secret));
}

// ---------------------------------------------------------------------------
// Webhook payload parsing (real Cloud API shape)
// ---------------------------------------------------------------------------
{
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: "phid" },
              contacts: [{ profile: { name: "Marco" }, wa_id: "33612345678" }],
              messages: [
                { from: "33612345678", id: "wamid.A1", timestamp: "1720512000", type: "text", text: { body: "Yes, interested! What is the stack?" } },
                { from: "33612345678", id: "wamid.A2", timestamp: "1720512060", type: "image", image: { id: "img1" } },
              ],
            },
          },
          {
            field: "messages",
            value: {
              // status-only delivery (read receipt) — must be ignored
              metadata: { phone_number_id: "phid" },
              statuses: [{ id: "wamid.A1", status: "read", timestamp: "1720512120" }],
            },
          },
        ],
      },
    ],
  };
  const msgs = parseWhatsAppWebhook(payload);
  ok("parse: one text message extracted", msgs.length === 1);
  ok("parse: from preserved", msgs[0]?.from === "33612345678");
  ok("parse: provider id preserved", msgs[0]?.providerId === "wamid.A1");
  ok("parse: text preserved", msgs[0]?.text === "Yes, interested! What is the stack?");
  ok("parse: timestamp in ms", msgs[0]?.timestamp === 1720512000000);
  ok("parse: sender phone-number id preserved for tenant resolution", msgs[0]?.senderPhoneNumberId === "phid");

  ok("parse: empty payload → []", parseWhatsAppWebhook({}).length === 0);
  ok("parse: null → [] (no throw)", parseWhatsAppWebhook(null).length === 0);
  ok("parse: junk entry → [] (no throw)", parseWhatsAppWebhook({ entry: [42, "x", {}] }).length === 0);

  const receipts = parseWhatsAppDeliveryStatuses(payload);
  ok("receipt: status-only payload extracts delivery events", receipts.length === 1);
  ok("receipt: provider id is preserved", receipts[0]?.providerMessageId === "wamid.A1");
  ok("receipt: sender phone-number id scopes reconciliation", receipts[0]?.senderPhoneNumberId === "phid");
  ok("receipt: delivery timestamp is normalized to milliseconds", receipts[0]?.occurredAt === 1720512120000);
  ok("receipt: accepts only known statuses", parseWhatsAppDeliveryStatuses({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "phid" }, statuses: [{ id: "wamid.X", status: "unknown", timestamp: "1720512120" }] } }] }],
  }).length === 0);
  ok("receipt: ignores incomplete status records", parseWhatsAppDeliveryStatuses({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "phid" }, statuses: [{ status: "delivered", timestamp: "not-a-time" }] } }] }],
  }).length === 0);
}

// Candidate opt-outs are deterministic routing commands, not LLM input. They
// must halt drafting before the message can enter any agent conversation.
ok("opt-out: STOP blocks regardless of case", isWhatsAppOptOut("  stop "));
ok("opt-out: unsubscribe blocks", isWhatsAppOptOut("UNSUBSCRIBE"));
ok("opt-out: ordinary candidate reply is not an opt-out", !isWhatsAppOptOut("Yes, please share the role details."));

// ---------------------------------------------------------------------------
// Reply prompt shape
// ---------------------------------------------------------------------------
{
  const { system, prompt } = buildReplyPrompt({
    inbound: "What's the salary range?",
    lastOutbound: "Hi Marco, we have a Staff Engineer role...",
    roleSummary: '{"title":"Staff Engineer","seniority":"Staff"}',
  });
  ok("prompt: system forbids AI mentions", /never mention\s+AI/i.test(system));
  ok("prompt: system forbids salary promises", /never promise salary/i.test(system));
  ok("prompt: includes inbound", prompt.includes("What's the salary range?"));
  ok("prompt: includes thread context", prompt.includes("Staff Engineer role"));
}

// ---------------------------------------------------------------------------
// Autopilot decision matrix
// ---------------------------------------------------------------------------
const CLEAN_REPLY = "Good question! The team works in TypeScript and Go, mostly backend services. Want me to set up a quick call so you can meet the lead?";
{
  // autopilot off → queue
  const d = decideAutopilot(CLEAN_REPLY, { autopilot: false, canary_remaining: 0 });
  ok("decide: autopilot off queues", d.action === "queue" && d.reasons.includes("autopilot-off"));
}
{
  // canary burning → queue even with autopilot on
  const d = decideAutopilot(CLEAN_REPLY, { autopilot: true, canary_remaining: 3 });
  ok("decide: canary queues", d.action === "queue" && d.reasons.includes("canary"));
}
{
  // Clean copy is still a draft: an external reply always needs a named human
  // to review and explicitly send it.
  const d = decideAutopilot(CLEAN_REPLY, { autopilot: true, canary_remaining: 0 });
  ok("decide: clean reply queues for human review", d.action === "queue" && d.reasons.includes("human-review-required"));
  ok("decide: clean queued text is non-empty", d.text.length > 20);
}
{
  // salary commitment → queue
  const d = decideAutopilot("The salary is 95 000 € plus bonus, guaranteed.", { autopilot: true, canary_remaining: 0 });
  ok("decide: salary commitment queues", d.action === "queue" && d.reasons.some((r) => r.startsWith("commitment-")));
}
{
  const d = decideAutopilot("We can offer you the role right away, you're hired!", { autopilot: true, canary_remaining: 0 });
  ok("decide: offer commitment queues", d.action === "queue" && d.reasons.some((r) => r.startsWith("commitment-")));
}
{
  // AI tell in the draft → queue with gate reason
  const d = decideAutopilot("As an AI assistant, I think the stack is TypeScript.", { autopilot: true, canary_remaining: 0 });
  ok("decide: AI tell queues via gate", d.action === "queue" && d.reasons.some((r) => r.startsWith("gate:")));
}
{
  // status narration → queue
  const d = decideAutopilot("Processing your request...", { autopilot: true, canary_remaining: 0 });
  ok("decide: status narration queues", d.action === "queue");
}
{
  // Soft AI-isms are cleaned, then the draft still waits for human review.
  const d = decideAutopilot(
    "We could leverage your robust experience — the team ships weekly and would love to talk this week.",
    { autopilot: true, canary_remaining: 0 },
  );
  ok("decide: AI-isms cleaned then queues", d.action === "queue" && d.reasons.includes("human-review-required"));
  ok("decide: 'leverage' gone from queued text", !/leverage/i.test(d.text));
  ok("decide: em-dash gone from queued text", !d.text.includes("—"));
}
{
  // multiple reasons accumulate
  const d = decideAutopilot("As an AI, the salary is 95 000 € guaranteed.", { autopilot: false, canary_remaining: 2 });
  ok("decide: reasons accumulate", d.action === "queue" && d.reasons.length >= 3);
}
{
  // empty guardrails object = safest path (queue)
  const d = decideAutopilot(CLEAN_REPLY, {});
  ok("decide: empty guardrails queue by default", d.action === "queue" && d.reasons.includes("autopilot-off"));
}

// Robustness
{
  let threw = false;
  try {
    decideAutopilot(null as unknown as string, { autopilot: true });
    decideAutopilot("", {});
    verifyMetaSignature("", null, "");
  } catch { threw = true; }
  ok("robust: no throw on odd input", !threw);
}

const webhookRoute = readFileSync(new URL("../src/app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8");
ok("webhook never synthesizes an outreach approval", !/from\("outreach_approvals"\)\.insert/.test(webhookRoute));
ok("webhook stores generated WhatsApp replies as human-review blocked", /status:\s*"blocked"/.test(webhookRoute));
ok("webhook resolves workspace from the registered WhatsApp sender", /from\("whatsapp_senders"\)/.test(webhookRoute));
ok("webhook handles a candidate opt-out before any model call", /isWhatsAppOptOut\(msg\.text\)/.test(webhookRoute));
ok("webhook refuses to acknowledge events when durable storage is unavailable", /return NextResponse\.json\(\{ ok: false, reason: "Service client unavailable\." \}, \{ status: 503 \}\)/.test(webhookRoute));
ok("webhook reconciles signed delivery receipts through a service-only RPC", /record_whatsapp_delivery_event/.test(webhookRoute));
ok("webhook parses delivery receipts separately from candidate messages", /parseWhatsAppDeliveryStatuses\(payload\)/.test(webhookRoute));

console.log(`RESULT autopilot: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
