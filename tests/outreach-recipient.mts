/**
 * Pins for Autopilot / Approve→Send recipient resolution.
 */
import { outreachDispatchRecipient } from "../src/lib/outreach-recipient.ts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const candidate = {
  email: "candidate@example.com",
  phone: "+15551234567",
  linkedinUrl: "https://www.linkedin.com/in/candidate",
};

ok(
  "first-touch email uses candidate email",
  outreachDispatchRecipient({ channel: "Email" }, candidate) === "candidate@example.com",
);
ok(
  "override wins",
  outreachDispatchRecipient(
    { channel: "Email", recipientOverride: "tony@mantu.com" },
    candidate,
  ) === "tony@mantu.com",
);
ok(
  "interviewer prep without override fails closed (never candidate)",
  outreachDispatchRecipient({ channel: "Email", prepPurpose: "interviewer" }, candidate) === "",
);
ok(
  "interviewer prep with override uses interviewer",
  outreachDispatchRecipient(
    { channel: "Email", prepPurpose: "interviewer", recipientOverride: "tony@mantu.com" },
    candidate,
  ) === "tony@mantu.com",
);
ok(
  "candidate confirmation uses candidate email",
  outreachDispatchRecipient(
    { channel: "Email", prepPurpose: "candidate_confirmation" },
    candidate,
  ) === "candidate@example.com",
);

const cron = await import("node:fs").then((fs) =>
  fs.readFileSync("src/app/api/cron/autopilot-send-outreach/route.ts", "utf8"),
);
ok(
  "autopilot sweep uses outreachDispatchRecipient",
  /outreachDispatchRecipient/.test(cron)
    && /if \(!recipient\)/.test(cron)
    && /reason:\s*"no_recipient"/.test(cron),
);
const dispatch = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/rei-autopilot-dispatch.ts", "utf8"),
);
ok(
  "Autopilot mailbox gate aligns with Graph live-ready (not vanity DNS only)",
  /mailboxSeatReadyForAutopilot/.test(dispatch) && /Microsoft Graph/.test(dispatch),
);
ok(
  "Graph domain_verified heal fails closed on Supabase error",
  /healErr/.test(dispatch) && /liveMailbox = undefined/.test(dispatch),
);

const store = await import("node:fs").then((fs) => fs.readFileSync("src/lib/store.ts", "utf8"));
ok(
  "Approve→Send uses outreachDispatchRecipient for Email recipient",
  /sendApprovedOutreach[\s\S]{0,4000}outreachDispatchRecipient\(msg, candidate\)/.test(store),
);

const sendRoute = await import("node:fs").then((fs) =>
  fs.readFileSync("src/app/api/outreach/send/route.ts", "utf8"),
);
ok(
  "Approve→Send Graph/DNS domain_verified heal fails closed on Supabase error",
  /const \{ error: healErr \}/.test(sendRoute)
    && /outreach send Graph domain_verified heal failed/.test(sendRoute)
    && /if \(healErr\)[\s\S]{0,300}else \{[\s\S]{0,80}seat\.domain_verified = true/.test(sendRoute),
);

console.log(`RESULT outreach-recipient: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
