/* ==========================================================================
   tests/linkedin-send-contract.mts
   Fail-closed LinkedIn delivery: sealed approve copy, invite ≤200, send proof.
   ========================================================================== */

import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const src = readFileSync("src/lib/openbot/linkedin-send.ts", "utf8");
const invite = readFileSync("src/lib/linkedin-invite-note.ts", "utf8");
const channel = readFileSync("src/lib/linkedin-channel.ts", "utf8");
const approve = readFileSync("src/app/api/outreach/approve/route.ts", "utf8");

ok(
  "invite note hard-cap is 200",
  /LINKEDIN_INVITE_NOTE_MAX\s*=\s*200/.test(invite) &&
    /LINKEDIN_INVITE_NOTE_MAX/.test(src),
);
ok(
  "OpenBot types sealed body verbatim (no last-mile humanize)",
  /never re-humanize/.test(src) &&
    !/humanizeText\(input\.messageBody\)/.test(src) &&
    /const body = \(input\.messageBody \?\? ""\)\.trim\(\)/.test(src),
);
ok(
  "oversized sealed Connect notes fail closed (no silent rewrite)",
  /Re-approve a short note in Outreach|refusing to rewrite sealed copy at send/.test(src),
);
ok(
  "vendor LinkedIn channel posts sealed body (no re-humanize)",
  /Exact recruiter-approved body/.test(channel) &&
    !/body:\s*humanizeText\(req\.body\)/.test(channel),
);
ok(
  "approve API echoes sealed subject/body for client persistence",
  /sealed:\s*true/.test(approve) && /subject,\s*body/.test(approve),
);
ok(
  "invite refuses disabled Send",
  /Send invitation is disabled[\s\S]{0,120}not claiming delivery/.test(src),
);
ok(
  "invite requires Sent/Pending UI proof",
  /pending\|invitation sent\|invite sent\|sent\$/i.test(src) &&
    /no Sent\/Pending proof/.test(src),
);
ok(
  "message refuses disabled Send",
  /Send is disabled \(InMail\/gate\)/.test(src),
);
ok(
  "message requires sent UI proof",
  /message sent\|sent successfully\|your message was sent\|delivered/i.test(src) &&
    /no Message-sent proof/.test(src),
);
ok(
  "never truncates invite notes at 280",
  !/\b280\b/.test(src) || /false allowance|was a false/.test(src),
);

// Seats PATCH ownership fail-closed
const seats = readFileSync("src/app/api/fleet/seats/route.ts", "utf8");
ok(
  "PATCH rejects foreign computerId steal",
  /computerId already bound to another seat|already bound to another seat/.test(seats),
);

// Campaign ops must not drive __orphan__ via Hermes computerId
const campaign = readFileSync("src/components/campaigns/campaign-agents-panel.tsx", "utf8");
ok(
  "campaign ops match seat-owned rows only",
  /row\.seatId === seat\.id/.test(campaign) &&
    !(/__orphan__[\s\S]{0,40}byComp|byComp[\s\S]{0,120}__orphan__/.test(campaign)),
);

console.log(`linkedin-send-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
