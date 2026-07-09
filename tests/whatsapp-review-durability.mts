import { existsSync, readFileSync, readdirSync } from "fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const policyUrl = new URL("../src/lib/whatsapp-review-policy.ts", import.meta.url);
const reviewRouteUrl = new URL("../src/app/api/outreach/whatsapp-review/route.ts", import.meta.url);
const inboundUrl = new URL("../src/lib/whatsapp-inbound.ts", import.meta.url);
const webhookRouteUrl = new URL("../src/app/api/webhooks/whatsapp/route.ts", import.meta.url);
const cronRouteUrl = new URL("../src/app/api/cron/dispatch-outbound/route.ts", import.meta.url);
const reviewQueueUrl = new URL("../src/components/replies/whatsapp-review-queue.tsx", import.meta.url);
const repliesPageUrl = new URL("../src/app/replies/page.tsx", import.meta.url);

ok("WhatsApp review durability policy exists", existsSync(policyUrl));
ok("authenticated WhatsApp review endpoint exists", existsSync(reviewRouteUrl));
ok("recoverable inbound WhatsApp processor exists", existsSync(inboundUrl));

if (existsSync(policyUrl)) {
  const policy = await import(policyUrl.href);
  ok(
    "known sender receipt is retried when durable persistence fails",
    policy.shouldAcknowledgeWhatsAppReceipt({ senderKnown: true, persisted: false }) === false,
  );
  ok(
    "unknown receipt is safely acknowledged without a cross-workspace retry",
    policy.shouldAcknowledgeWhatsAppReceipt({ senderKnown: false, persisted: false }) === true,
  );
  ok(
    "only a blocked candidate reply can enter human WhatsApp review",
    policy.isReviewableWhatsAppDraft({ channel: "WhatsApp", status: "blocked", type: "candidate_reply", reviewDecision: null }) === true,
  );
  ok(
    "a rejected or dispatched row cannot be approved again",
    policy.isReviewableWhatsAppDraft({ channel: "WhatsApp", status: "blocked", type: "candidate_reply", reviewDecision: "rejected" }) === false &&
      policy.isReviewableWhatsAppDraft({ channel: "WhatsApp", status: "queued", type: "candidate_reply", reviewDecision: null }) === false,
  );
  ok(
    "only stored unfinished inbound rows with a sender mapping are eligible for automatic recovery",
    policy.canRecoverStoredWhatsAppInbound({ processed: false, senderId: "sender-1" }) === true &&
      policy.canRecoverStoredWhatsAppInbound({ processed: true, senderId: "sender-1" }) === false &&
      policy.canRecoverStoredWhatsAppInbound({ processed: false, senderId: null }) === false,
  );
}

if (existsSync(inboundUrl)) {
  const inboundProcessor = readFileSync(inboundUrl, "utf8");
  ok(
    "recovery skips rows with a still-active processing lease",
    /processing_lease_until\.is\.null,processing_lease_until\.lte\./.test(inboundProcessor),
  );
}

if (existsSync(reviewRouteUrl)) {
  const reviewRoute = readFileSync(reviewRouteUrl, "utf8");
  ok("review endpoint verifies an authenticated workspace role", /auth\.getUser\(\)/.test(reviewRoute) && /can\(role as Role, "outreach"\)/.test(reviewRoute));
  ok("review endpoint releases messages only through an RPC", /rpc\("review_whatsapp_outbound"/.test(reviewRoute));
}

const webhookRoute = readFileSync(webhookRouteUrl, "utf8");
const cronRoute = readFileSync(cronRouteUrl, "utf8");
ok("known-sender receipt persistence failures produce a retryable webhook response", /retryableReceiptFailure[\s\S]*status:\s*503/.test(webhookRoute));
ok("webhook routes stored inbound events through the lease-backed processor", /processStoredWhatsAppInbound/.test(webhookRoute));
ok("daily dispatch cron recovers stored WhatsApp inbound events", /recoverPendingWhatsAppInbound/.test(cronRoute));

ok("Replies includes a WhatsApp human-review surface", existsSync(reviewQueueUrl));
if (existsSync(reviewQueueUrl)) {
  const reviewQueue = readFileSync(reviewQueueUrl, "utf8");
  ok("review surface loads only from the authenticated review endpoint", /fetch\("\/api\/outreach\/whatsapp-review"/.test(reviewQueue));
  ok("review surface exposes explicit approve and reject actions", /action:\s*"approve"/.test(reviewQueue) && /action:\s*"reject"/.test(reviewQueue));
  ok("review surface keeps durable draft content read-only", /readOnly/.test(reviewQueue));
}
const repliesPage = readFileSync(repliesPageUrl, "utf8");
ok("Replies renders the WhatsApp human-review surface", /WhatsAppReviewQueue/.test(repliesPage));

const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const reviewMigration = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, source: readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8") }))
  .find(({ source }) => source.includes("review_whatsapp_outbound"));
ok("migration adds an authoritative WhatsApp review decision RPC", Boolean(reviewMigration));
if (reviewMigration) {
  ok("review migration records a named review decision", /review_decision/.test(reviewMigration.source) && /reviewed_by/.test(reviewMigration.source));
  ok(
    "review approval hashes can resolve pgcrypto under the function search path",
    /review_whatsapp_outbound[\s\S]*?set search_path = public, extensions/.test(reviewMigration.source),
  );
  ok("recovery metadata binds stored WhatsApp inbound rows to a sender", /whatsapp_sender_id/.test(reviewMigration.source) && /processing_attempts/.test(reviewMigration.source));
  ok("recovery migration locks a lease before an inbound retry", /claim_whatsapp_inbound_processing/.test(reviewMigration.source) && /processing_claim_id/.test(reviewMigration.source));
  ok("each generated WhatsApp review draft is bound to one inbound message", /inbound_message_id/.test(reviewMigration.source));
}

console.log(`RESULT whatsapp-review-durability: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
