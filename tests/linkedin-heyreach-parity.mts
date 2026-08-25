import { existsSync, readFileSync } from "node:fs";
import {
  isLinkedInEventType,
  isReplyLikeEvent,
  linkedInEventLabel,
  normalizeLinkedInWebhookBody,
  shouldEnqueueClassifyFromRecord,
} from "../src/lib/linkedin-events";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("reply is event type", isLinkedInEventType("reply"));
ok("bogus is not event type", !isLinkedInEventType("inmail_sent"));
ok("reply is reply-like", isReplyLikeEvent("reply"));
ok("accepted is not reply-like", !isReplyLikeEvent("connection_accepted"));
ok("label for reply", linkedInEventLabel("reply") === "Candidate reply");

const legacy = normalizeLinkedInWebhookBody({
  routeKey: "rk-" + "x".repeat(16),
  providerId: "prov-1",
  fromProfileUrl: "https://www.linkedin.com/in/jane",
  body: "I'm interested",
});
ok("legacy normalizes to reply", !("error" in legacy) && legacy.eventType === "reply");
ok("legacy keeps routeKey", !("error" in legacy) && legacy.routeKey.startsWith("rk-"));

const v1 = normalizeLinkedInWebhookBody({
  schemaVersion: "2026-08-25.li-events.v1",
  routeKey: "rk-" + "y".repeat(16),
  eventId: "evt-acc-1",
  eventType: "connection_accepted",
  candidate: { profileUrl: "https://www.linkedin.com/in/jane" },
  thread: { providerThreadKey: "t1" },
  payload: { body: "" },
});
ok("v1 accepts connection_accepted", !("error" in v1) && v1.eventType === "connection_accepted");
ok(
  "v1 requires body for reply",
  "error" in
    normalizeLinkedInWebhookBody({
      schemaVersion: "2026-08-25.li-events.v1",
      routeKey: "rk-" + "z".repeat(16),
      eventId: "evt-r-1",
      eventType: "reply",
      candidate: { profileUrl: "https://www.linkedin.com/in/jane" },
      payload: { body: "" },
    }),
);

ok(
  "short route key rejected",
  "error" in
    normalizeLinkedInWebhookBody({
      routeKey: "short",
      providerId: "p",
      fromProfileUrl: "https://www.linkedin.com/in/x",
      body: "hi",
    }),
);

ok(
  "enqueue on new reply",
  shouldEnqueueClassifyFromRecord({
    ok: true,
    duplicate: false,
    event_type: "reply",
    inbound_id: "inb-1",
  }),
);
ok(
  "no enqueue on duplicate",
  !shouldEnqueueClassifyFromRecord({
    ok: true,
    duplicate: true,
    event_type: "reply",
    inbound_id: "inb-1",
  }),
);
ok(
  "no enqueue on lifecycle",
  !shouldEnqueueClassifyFromRecord({
    ok: true,
    duplicate: false,
    event_type: "connection_accepted",
    inbound_id: null,
  }),
);

const mig59 = existsSync("supabase/migrations/0059_linkedin_heyreach_parity.sql")
  ? readFileSync("supabase/migrations/0059_linkedin_heyreach_parity.sql", "utf8")
  : "";
ok("migration 0059 exists", mig59.length > 0);
ok("0059 record_linkedin_channel_event", /record_linkedin_channel_event/i.test(mig59));
ok("0059 read_inbound_message_for_loop", /read_inbound_message_for_loop/i.test(mig59));
ok("0059 correlate_linkedin_inbound", /correlate_linkedin_inbound/i.test(mig59));

const webhook = readFileSync("src/app/api/webhooks/linkedin/route.ts", "utf8");
ok("webhook uses channel event RPC", /record_linkedin_channel_event/.test(webhook));
ok("webhook still HMAC", /x-aria-signature/.test(webhook));

const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
ok("worker reads LinkedIn-capable inbound", /read_inbound_message_for_loop/.test(worker));

const sim = readFileSync("src/app/api/linkedin/simulate/route.ts", "utf8");
ok("simulate route exists", /record_linkedin_channel_event/.test(sim));

const panel = readFileSync("src/components/settings/linkedin-connections-panel.tsx", "utf8");
ok("settings simulate UI", /Simulate event/.test(panel));

const inbox = readFileSync("src/components/replies/linkedin-inbox-panel.tsx", "utf8");
ok("replies LinkedIn inbox", /Messaging inbox/.test(inbox));

const plan = readFileSync("docs/LINKEDIN_HEYREACH_PARITY.md", "utf8");
ok("scenario plan documents reply webhook", /S10/.test(plan) && /reply webhook/i.test(plan));

console.log(`RESULT linkedin-heyreach-parity: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
