import { isNeedEmail, SAMPLE_MANTU_EMAIL } from "../src/lib/mock-ai";
import {
  filterOutlookNeeds,
  formatNeedAsIntakeEmail,
  needPreview,
  seatHasOutlookMailbox,
  demoOutlookNeeds,
} from "../src/lib/outlook-needs";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const hiring = {
  messageId: "m1",
  threadId: "t1",
  seatId: "seat_1",
  from: "hm@acme.example",
  subject: "New role — Senior Platform Engineer",
  body: "Please open a hiring request for a Senior Platform Engineer. Job description attached.",
  receivedAt: "2026-08-25T10:00:00.000Z",
};
const noise = {
  messageId: "m2",
  threadId: "t2",
  seatId: "seat_1",
  from: "news@vendor.example",
  subject: "Weekly product digest",
  body: "Here is your newsletter for the week.",
  receivedAt: "2026-08-25T11:00:00.000Z",
};
const mantu = {
  messageId: "m3",
  threadId: "t3",
  seatId: "seat_1",
  from: "recruiter@mantu.example",
  subject: "FW: need",
  body: SAMPLE_MANTU_EMAIL,
  receivedAt: "2026-08-25T12:00:00.000Z",
};

ok("isNeedEmail catches new role subject", isNeedEmail(hiring.subject, hiring.body));
ok("isNeedEmail rejects newsletter", !isNeedEmail(noise.subject, noise.body));
ok(
  "isNeedEmail catches body-only hiring request",
  isNeedEmail("FW: please review", "Please open a hiring request for a Senior Platform Engineer."),
);
ok(
  "isNeedEmail rejects body without JD keywords",
  !isNeedEmail("Quick sync?", "Can we chat tomorrow about the roadmap?"),
);

const filtered = filterOutlookNeeds([noise, hiring, mantu]);
ok("filters to hiring needs only", filtered.length === 2);
ok("newest first (mantu then hiring)", filtered[0]?.messageId === "m3" && filtered[1]?.messageId === "m1");
ok("preview truncated with ellipsis for long body", needPreview("x".repeat(200)).endsWith("…"));
ok("preview keeps short body intact", needPreview("short") === "short");

const formatted = formatNeedAsIntakeEmail(filtered[1]!);
ok("format includes From/Subject", /^From: /.test(formatted) && /Subject: /.test(formatted));
ok("format includes body", /Senior Platform Engineer/.test(formatted));

ok(
  "Graph seat with account + mode=live is connected",
  seatHasOutlookMailbox({
    provider: "Microsoft Graph",
    connectedAccount: "ops@acme.example",
    mode: "live",
  }),
);
ok(
  "Graph seat with account but mode=mock is not connected",
  !seatHasOutlookMailbox({
    provider: "Microsoft Graph",
    connectedAccount: "ops@acme.example",
    mode: "mock",
  }),
);
ok(
  "Graph seat without account is not connected",
  !seatHasOutlookMailbox({ provider: "Microsoft Graph", connectedAccount: "", mode: "live" }),
);
ok(
  "Gmail seat is not Outlook mailbox",
  !seatHasOutlookMailbox({
    provider: "Gmail API",
    connectedAccount: "ops@gmail.com",
    mode: "live",
  }),
);

ok("demoOutlookNeeds returns two labelled samples", demoOutlookNeeds().length === 2);
ok("demoOutlookNeeds marked demo", demoOutlookNeeds().every((n) => n.demo === true));
ok(
  "demo backend subject looks like a need",
  isNeedEmail(demoOutlookNeeds()[0]!.subject, demoOutlookNeeds()[0]!.body),
);

console.log(`RESULT outlook-needs: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
