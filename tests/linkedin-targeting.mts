/**
 * Campaign targeting: the section 4 table as a pure function
 * (docs/outreach/ARIA-LINKEDIN-CONNECT.md, section 4 and S6).
 *
 *   - every row of the table, exhaustively, with the counter it spends
 *   - cap hold: a spent limit means "Waiting for tomorrow's limit", never a send
 *   - launch scope: a person whose drafts were not shown at launch is held,
 *     and no branch adds a person to a launched list
 *   - ordering: highest match score, then warm people, then new connects
 *   - the connection note stays under 200 characters and passes the human gate
 *   - the launch route and the 0060 RPC accept two drafts per person
 *   - copy: Connect LinkedIn, no vendor names, no em dashes, never AI
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  LINKEDIN_CONNECT_NOTE_MAX,
  LINKEDIN_DAILY_CONNECT_CAP,
  LINKEDIN_DAILY_MESSAGE_CAP,
  LOOP_REPLY_DELAY_MAX_MS,
  LOOP_REPLY_DELAY_MIN_MS,
  decideFirstMessageAfterAccept,
  loopNextDayStart,
  type LoopControls,
} from "../src/lib/linkedin-loop";
import {
  LINKEDIN_CONNECT_PENDING_DAYS,
  LINKEDIN_FIRST_MESSAGE_MAX_WORDS,
  NO_EVENTS,
  TARGETING_COPY,
  connectDraftId,
  decideCampaignAction,
  decisionLabel,
  draftConnectNote,
  planCampaignDay,
  wordCount,
  type CampaignCaps,
  type CampaignDecision,
  type CampaignPerson,
  type CampaignPersonEvents,
  type VendorDegree,
} from "../src/lib/linkedin-targeting";
import { LAUNCH_COPY, LAUNCH_DRAFTS_CAP, LAUNCH_PEOPLE_CAP, connectDraftAsLaunchDraft, launchDraftApproval } from "../src/lib/linkedin-campaign";
import { approvalHash, approvalScopeHash } from "../src/lib/outreach-content";
import { gateOutbound } from "../src/lib/gate";
import { testManifest } from "./test-manifest.mjs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function functionBlock(source: string, name: string, args = "\\("): string {
  const match = source.match(new RegExp(`create or replace function public\\.${name}${args}[\\s\\S]*?\\n\\$\\$;`, "i"));
  if (!match) throw new Error(`Missing function block: ${name}`);
  return match[0].replace(/\r\n/g, "\n");
}

const NOW = new Date("2026-09-02T12:00:00.000Z"); // 14:00 Paris, daytime
const NIGHT = new Date("2026-09-02T22:30:00.000Z"); // 00:30 Paris, quiet
const TZ = "Europe/Paris";
const PROFILE = "https://www.linkedin.com/in/marco-rossi";
const CONTROLS_ON: LoopControls = { killSwitch: false, loopEnabled: true, messageCap: 25, connectCap: 25, timezone: TZ };
const DAY_MS = 24 * 60 * 60_000;

function person(over: Partial<CampaignPerson> = {}): CampaignPerson {
  return { candidateId: "cand-1", profileUrl: PROFILE, matchScore: 82, launched: true, ...over };
}
function caps(over: Partial<CampaignCaps> = {}, controls: Partial<LoopControls> | null = {}): CampaignCaps {
  return {
    controls: controls === null ? null : { ...CONTROLS_ON, ...controls },
    messagesToday: 0,
    connectsToday: 0,
    now: NOW,
    quiet: { start: 21, end: 8 },
    timezone: TZ,
    ...over,
  };
}
function events(over: Partial<CampaignPersonEvents> = {}): CampaignPersonEvents {
  return { ...NO_EVENTS, ...over };
}
const iso = (ms: number) => new Date(ms).toISOString();
const inWindow = (from: Date, at: Date) => at.getTime() - from.getTime() >= LOOP_REPLY_DELAY_MIN_MS && at.getTime() - from.getTime() <= LOOP_REPLY_DELAY_MAX_MS;
const decide = (degree: VendorDegree, ev: Partial<CampaignPersonEvents> = {}, c: CampaignCaps = caps(), p: CampaignPerson = person()) =>
  decideCampaignAction(p, degree, events(ev), c);

const DEGREES: VendorDegree[] = [1, 2, 3, "unknown"];
const NOT_CONNECTED: VendorDegree[] = [2, 3, "unknown"];

// ---------------------------------------------------------------------------
// The table, row by row
// ---------------------------------------------------------------------------
{
  // Not a connection: connection request with a note under 200 characters, connect cap.
  for (const degree of NOT_CONNECTED) {
    const d = decide(degree);
    ok(`table: degree ${degree} → connection request, connect cap`, d.action === "connect" && d.countsAgainst === "connect");
    ok(`table: degree ${degree} → note limit is 200`, d.action === "connect" && d.noteMax === 200 && d.noteMax === LINKEDIN_CONNECT_NOTE_MAX);
  }

  // Degree 1: first message under 80 words, message cap.
  const one = decide(1);
  ok("table: degree 1 → first message, message cap", one.action === "first-message" && one.countsAgainst === "message" && one.trigger === "degree-1");
  ok("table: degree 1 → word limit is 80", one.action === "first-message" && one.wordMax === 80 && one.wordMax === LINKEDIN_FIRST_MESSAGE_MAX_WORDS);
  ok("table: degree 1 → sent 2 to 10 minutes out, never instant", one.action === "first-message" && inWindow(NOW, one.sendAt));

  // CONNECTION_REQUEST_ACCEPTED: first message scheduled 2 to 10 minutes out, message cap.
  for (const degree of DEGREES) {
    const d = decide(degree, { connectSentAt: iso(NOW.getTime() - DAY_MS), acceptedAt: iso(NOW.getTime() - 60_000) });
    ok(`table: accepted (degree ${degree}) → first message, message cap`, d.action === "first-message" && d.countsAgainst === "message" && d.trigger === "accepted");
    ok(`table: accepted (degree ${degree}) → 2 to 10 minutes out`, d.action === "first-message" && inWindow(NOW, d.sendAt));
  }
  const night = decide("unknown", { acceptedAt: iso(NIGHT.getTime() - 1_000) }, caps({ now: NIGHT }));
  ok(
    "table: accepted at 00:30 Paris → first message after 08:00 Paris, jittered",
    night.action === "first-message" && night.sendAt.getTime() >= Date.parse("2026-09-03T06:00:00.000Z") + LOOP_REPLY_DELAY_MIN_MS,
  );
  // Same clock, same seed rule as the S5 accepted path: the decision is the S5 decision.
  const s5 = decideFirstMessageAfterAccept({
    now: NOW,
    seed: `cand-1:${PROFILE}:accepted`,
    grant: { id: "g", channel: "LinkedIn", campaignId: "c", revokedAt: null, dailyCap: 20, quietStart: 21, quietEnd: 8, timezone: TZ, scope: "campaign" },
    controls: CONTROLS_ON,
    optedOut: false,
    messagesToday: 0,
  });
  const s6 = decide("unknown", { acceptedAt: iso(NOW.getTime() - 60_000) });
  ok("table: the accepted branch lands on the same send time as the S5 accepted path", s5.action === "schedule" && s6.action === "first-message" && s5.sendAt.getTime() === s6.sendAt.getTime());

  // Reply: existing reply loop, message cap.
  for (const degree of DEGREES) {
    const d = decide(degree, { replied: true, connectSentAt: iso(NOW.getTime() - DAY_MS), acceptedAt: iso(NOW.getTime() - 3_600_000) });
    ok(`table: reply (degree ${degree}) → reply loop, message cap`, d.action === "reply-loop" && d.countsAgainst === "message");
  }
  const repliedBeforeFirst = decide(1, { replied: true });
  ok("table: a reply beats the first message (no first message on top of a conversation)", repliedBeforeFirst.action === "reply-loop");

  // Opt-out: cancel queued connects and messages, no counter.
  for (const degree of DEGREES) {
    const d = decide(degree, { optedOut: true, acceptedAt: iso(NOW.getTime() - 60_000) });
    ok(`table: opt-out (degree ${degree}) → cancel, nothing counted`, d.action === "cancel" && d.countsAgainst === "none" && d.reason === "opted-out");
  }
  ok("table: opt-out wins over a reply", decide(1, { optedOut: true, replied: true }).action === "cancel");
  ok("table: opt-out wins over not launched", decide(1, { optedOut: true }, caps(), person({ launched: false })).action === "cancel");
  ok("table: opt-out wins over the kill switch", decide(1, { optedOut: true }, caps({}, { killSwitch: true })).action === "cancel");

  // Connect pending more than 14 days: no-response, do not withdraw, no counter.
  const stale = decide("unknown", { connectSentAt: iso(NOW.getTime() - 15 * DAY_MS) });
  ok("table: connect pending 15 days → no-response, nothing counted", stale.action === "no-response" && stale.countsAgainst === "none" && stale.pendingDays === 15);
  ok("table: no-response is a mark, never a withdraw or a send", !("sendAt" in stale) && stale.action !== "connect");
  const exactly = decide("unknown", { connectSentAt: iso(NOW.getTime() - 14 * DAY_MS) });
  ok("table: connect pending exactly 14 days → still pending, not yet no-response", exactly.action === "hold" && exactly.reason === "connect-pending");
  const fresh = decide("unknown", { connectSentAt: iso(NOW.getTime() - 2 * DAY_MS) });
  ok("table: connect pending 2 days → hold, no second request, nothing counted", fresh.action === "hold" && fresh.reason === "connect-pending" && fresh.countsAgainst === "none");
  ok("table: the pending window is 14 days", LINKEDIN_CONNECT_PENDING_DAYS === 14);
  const staleDegreeOne = decide(1, { connectSentAt: iso(NOW.getTime() - 20 * DAY_MS) });
  ok("table: a pending request outranks a later degree report", staleDegreeOne.action === "no-response");

  // Done with this person: the first message went out.
  const sent = decide("unknown", { connectSentAt: iso(NOW.getTime() - DAY_MS), acceptedAt: iso(NOW.getTime() - 3_600_000), firstMessageSentAt: iso(NOW.getTime() - 600_000) });
  ok("table: first message sent → hold, nothing more from targeting", sent.action === "hold" && sent.reason === "first-message-sent" && sent.countsAgainst === "none");
}

// ---------------------------------------------------------------------------
// Launch scope: the human gate
// ---------------------------------------------------------------------------
{
  for (const degree of DEGREES) {
    const d = decide(degree, {}, caps(), person({ launched: false }));
    ok(`launch: not launched (degree ${degree}) → hold not-launched, nothing counted`, d.action === "hold" && d.reason === "not-launched" && d.countsAgainst === "none");
  }
  const acceptedUnlaunched = decide("unknown", { acceptedAt: iso(NOW.getTime() - 60_000) }, caps(), person({ launched: false }));
  ok("launch: an accepted event for someone not launched → still held", acceptedUnlaunched.action === "hold" && acceptedUnlaunched.reason === "not-launched");
  const repliedUnlaunched = decide("unknown", { replied: true }, caps(), person({ launched: false }));
  ok("launch: a reply from someone not launched → still held (the loop needs a launch too)", repliedUnlaunched.action === "hold");

  // Nobody is added: a plan over N people has N entries, same ids.
  const list = ["a", "b", "c"].map((id) => ({ person: person({ candidateId: id, launched: id !== "b" }), degree: "unknown" as const, events: events() }));
  const plan = planCampaignDay(list, caps());
  ok("launch: the plan never adds a person", plan.entries.length === 3 && plan.entries.every((e) => ["a", "b", "c"].includes(e.person.candidateId)));
  ok("launch: an unlaunched person in the list is held, the others go", plan.entries.find((e) => e.person.candidateId === "b")?.decision.action === "hold" && plan.today.connects === 2);

  // Fail-closed controls.
  ok("launch: kill switch → hold", decide("unknown", {}, caps({}, { killSwitch: true })).action === "hold");
  ok("launch: missing controls row → hold kill-switch", (() => { const d = decide("unknown", {}, caps({}, null)); return d.action === "hold" && d.reason === "kill-switch"; })());
  ok("launch: sending off → hold sending-off", (() => { const d = decide(1, {}, caps({}, { loopEnabled: false })); return d.action === "hold" && d.reason === "sending-off"; })());
}

// ---------------------------------------------------------------------------
// Cap hold: a spent limit waits for tomorrow, visibly
// ---------------------------------------------------------------------------
{
  const tomorrow = loopNextDayStart(NOW, TZ);
  const spentConnects = decide("unknown", {}, caps({ connectsToday: 25 }));
  ok("cap: 25 connects today → the 26th waits, connect counter, next is a connect", spentConnects.action === "wait" && spentConnects.countsAgainst === "connect" && spentConnects.next === "connect");
  ok("cap: the wait names the reason a person sees", spentConnects.action === "wait" && spentConnects.reason === "waiting-for-tomorrow-limit" && decisionLabel(spentConnects) === LAUNCH_COPY.waitingForLimit);
  ok(
    "cap: the wait resumes tomorrow after quiet hours, jittered",
    spentConnects.action === "wait" && spentConnects.resumeAt.getTime() >= tomorrow.getTime() && spentConnects.resumeAt.getTime() >= Date.parse("2026-09-03T06:00:00.000Z") + LOOP_REPLY_DELAY_MIN_MS,
  );
  ok("cap: 24 connects today → the 25th goes", decide("unknown", {}, caps({ connectsToday: 24 })).action === "connect");
  ok("cap: a message cap spent does not hold a connect", decide("unknown", {}, caps({ messagesToday: 25 })).action === "connect");

  const spentMessages = decide(1, {}, caps({ messagesToday: 25 }));
  ok("cap: 25 messages today → degree 1 first message waits, message counter", spentMessages.action === "wait" && spentMessages.countsAgainst === "message" && spentMessages.next === "first-message");
  const spentAccepted = decide("unknown", { acceptedAt: iso(NOW.getTime() - 60_000) }, caps({ messagesToday: 25 }));
  ok("cap: 25 messages today → the accepted first message waits too", spentAccepted.action === "wait" && spentAccepted.countsAgainst === "message");
  ok("cap: a connect cap spent does not hold a first message", decide(1, {}, caps({ connectsToday: 25 })).action === "first-message");
  ok("cap: a limit under 25 holds at that limit", decide("unknown", {}, caps({ connectsToday: 3 }, { connectCap: 3 })).action === "wait");
  ok("cap: a limit above 25 is still 25", decide("unknown", {}, caps({ connectsToday: 25 }, { connectCap: 40 })).action === "wait");
  ok("cap: a limit of 0 sends nothing", decide("unknown", {}, caps({}, { connectCap: 0 })).action === "wait" && decide(1, {}, caps({}, { messageCap: 0 })).action === "wait");
  ok("cap: the product ceilings are 25 and 25", LINKEDIN_DAILY_MESSAGE_CAP === 25 && LINKEDIN_DAILY_CONNECT_CAP === 25);

  // Across a list: the first N fit, the rest wait, nobody is dropped.
  const thirty = Array.from({ length: 30 }, (_, i) => ({
    person: person({ candidateId: `c${String(i).padStart(2, "0")}`, matchScore: 90 - i }),
    degree: "unknown" as const,
    events: events(),
  }));
  const plan = planCampaignDay(thirty, caps({ connectsToday: 5 }));
  ok("cap: 30 connects with 5 used → 20 today, 10 waiting, none dropped", plan.today.connects === 20 && plan.waiting === 10 && plan.entries.length === 30);
  ok("cap: the ones who go are the 20 highest scores", plan.entries.slice(0, 20).every((e) => e.decision.action === "connect") && plan.entries.slice(20).every((e) => e.decision.action === "wait"));
  ok("cap: a waiting entry is still in the plan, visible, with tomorrow's resume time", plan.entries.slice(20).every((e) => e.decision.action === "wait" && e.decision.resumeAt.getTime() >= tomorrow.getTime()));

  const mixed = planCampaignDay(
    [
      { person: person({ candidateId: "m1", matchScore: 70 }), degree: 1, events: events() },
      { person: person({ candidateId: "m2", matchScore: 60 }), degree: 1, events: events() },
      { person: person({ candidateId: "k1", matchScore: 65 }), degree: "unknown", events: events() },
    ],
    caps({ messagesToday: 24 }),
  );
  ok("cap: counters are separate: one message slot left → m1 goes, m2 waits, the connect still goes", mixed.today.messages === 1 && mixed.today.connects === 1 && mixed.waiting === 1 && mixed.entries.find((e) => e.person.candidateId === "m2")?.decision.action === "wait");
}

// ---------------------------------------------------------------------------
// Ordering: highest match score, then warm, then new connects
// ---------------------------------------------------------------------------
{
  const plan = planCampaignDay(
    [
      { person: person({ candidateId: "new-90", matchScore: 90 }), degree: "unknown", events: events() },
      { person: person({ candidateId: "warm-80", matchScore: 80 }), degree: "unknown", events: events({ connectSentAt: iso(NOW.getTime() - DAY_MS), acceptedAt: iso(NOW.getTime() - 60_000) }) },
      { person: person({ candidateId: "new-80", matchScore: 80 }), degree: "unknown", events: events() },
      { person: person({ candidateId: "one-80", matchScore: 80 }), degree: 1, events: events() },
      { person: person({ candidateId: "new-70", matchScore: 70 }), degree: "unknown", events: events() },
      { person: person({ candidateId: "warm-95", matchScore: 95 }), degree: "unknown", events: events({ connectSentAt: iso(NOW.getTime() - DAY_MS), acceptedAt: iso(NOW.getTime() - 60_000) }) },
    ],
    caps(),
  );
  const order = plan.entries.map((e) => e.person.candidateId);
  ok("order: highest match score first", order[0] === "warm-95" && order[1] === "new-90" && order[order.length - 1] === "new-70");
  ok("order: at equal score, the accepted (warm) person goes before a degree 1 message, then the new connect", order.slice(2, 5).join(",") === "warm-80,one-80,new-80");
  ok("order: the input order does not matter", JSON.stringify(planCampaignDay([...plan.entries].reverse(), caps()).entries.map((e) => e.person.candidateId)) === JSON.stringify(order));
  const late = planCampaignDay(
    [
      { person: person({ candidateId: "hi", matchScore: 90 }), degree: "unknown", events: events() },
      { person: person({ candidateId: "lo", matchScore: 60 }), degree: "unknown", events: events({ connectSentAt: iso(NOW.getTime() - DAY_MS), acceptedAt: iso(NOW.getTime() - 60_000) }) },
    ],
    caps(),
  );
  ok("order: a warm person with a lower score does not jump a higher score", late.entries[0]?.person.candidateId === "hi");
}

// ---------------------------------------------------------------------------
// The connection note: under 200 characters, human, deterministic
// ---------------------------------------------------------------------------
{
  const note = draftConnectNote({ name: "Marco Rossi", headline: "Business Analyst at Acme" }, { roleTitle: "Senior Business Analyst", location: "Paris" });
  ok("note: under 200 characters", note.length <= LINKEDIN_CONNECT_NOTE_MAX);
  ok("note: uses the first name, the role, the place and the headline", /^Hi Marco, /.test(note) && /Senior Business Analyst/.test(note) && /Paris/.test(note) && /Business Analyst at Acme/.test(note));
  ok("note: passes the candidate-facing gate", gateOutbound(note).pass);
  ok("note: no em dash, never AI", !note.includes("—") && !/\b(AI|assistant|automation|bot|model)\b/.test(note));
  ok("note: deterministic for the same person and brief", note === draftConnectNote({ name: "Marco Rossi", headline: "Business Analyst at Acme" }, { roleTitle: "Senior Business Analyst", location: "Paris" }));

  const long = draftConnectNote(
    { name: "Maximilian", headline: "Principal Staff Software Engineering Manager for Distributed Systems and Platforms at A Very Long Company Name International Holdings" },
    { roleTitle: "Head of Engineering, Platform Infrastructure and Developer Experience", location: "Amsterdam, the Netherlands" },
  );
  ok("note: a long headline is dropped before the note breaks 200", long.length <= LINKEDIN_CONNECT_NOTE_MAX && /Head of Engineering/.test(long));
  const longest = draftConnectNote({ name: "N", headline: "" }, { roleTitle: "x".repeat(300), location: "" });
  ok("note: a 300-character role still yields a note under 200 (the shortest variant)", longest.length <= LINKEDIN_CONNECT_NOTE_MAX && gateOutbound(longest).pass);
  ok("note: no headline → no why clause, still a full note", !/stood out/.test(draftConnectNote({ name: "Anna K", headline: "" }, { roleTitle: "Analyst" })));
  ok("note: no name → still polite", /^Hi, /.test(draftConnectNote({ name: "", headline: "" }, { roleTitle: "Analyst" })));
  ok("note: an em dash in the brief never reaches the note", !draftConnectNote({ name: "A", headline: "Lead — Data" }, { roleTitle: "Data — Lead" }).includes("—"));

  // The note approval hashes exactly like the 0059 claim re-checks: empty subject, note as body.
  const draft = connectDraftAsLaunchDraft({ messageId: connectDraftId("camp-1", "cand-1"), candidateId: "cand-1", profileUrl: PROFILE, note });
  const approval = launchDraftApproval(draft);
  ok("note: approval body hash is sha256('\\n' + note)", approval?.body_hash === approvalHash("", note) && approval?.body_hash === sha256(`\n${note}`));
  ok("note: approval scope hash binds candidate, LinkedIn and the profile", approval?.scope_hash === approvalScopeHash({ candidateId: "cand-1", channel: "LinkedIn", recipient: PROFILE }));
  ok("note: the draft id is stable per campaign and person, under 120 characters", connectDraftId("camp-1", "cand-1") === draft.messageId && draft.messageId.length < 120 && connectDraftId("camp-1", "cand-2") !== draft.messageId);
  ok("note: an empty note is still approvable (an invitation without a note)", launchDraftApproval({ ...draft, body: "" }) !== null);
  ok("note: word count helper", wordCount("one two  three") === 3 && wordCount("  ") === 0);
}

// ---------------------------------------------------------------------------
// The launch route: two drafts per person, both gated
// ---------------------------------------------------------------------------
{
  const route = readFileSync("src/app/api/outreach/linkedin-loop/launch/route.ts", "utf8");
  ok("route: accepts connection notes capped at the shortlist size, under 200 characters", /connects: z\.array\(ConnectDraftSchema\)\.max\(LAUNCH_PEOPLE_CAP\)/.test(route) && /note: z\.string\(\)\.max\(LINKEDIN_CONNECT_NOTE_MAX\)/.test(route));
  ok("route: a note is approved like a first touch with an empty subject", /connectDraftAsLaunchDraft\(/.test(route) && /const drafts: LaunchDraft\[\] = \[\.\.\.messages, \.\.\.connects\]/.test(route));
  ok("route: two drafts per person at most", /drafts\.length > LAUNCH_DRAFTS_CAP/.test(route) && LAUNCH_DRAFTS_CAP === 2 * LAUNCH_PEOPLE_CAP);
  ok("route: every note passes the human gate before any write", route.indexOf("gateOutbound(connect.body)") > 0 && route.indexOf("gateOutbound(connect.body)") < route.indexOf('rpc("launch_linkedin_campaign"'));
  ok("route: a first message over 80 words is refused", /wordCount\(message\.body\) > LINKEDIN_FIRST_MESSAGE_MAX_WORDS/.test(route) && /"message-too-long"/.test(route));
  ok("route: the candidate-bound gate still runs on every draft with text", /for \(const draft of drafts\)/.test(route) && /validateCandidateBoundText\(draft\.body, internal\)/.test(route));
}

// ---------------------------------------------------------------------------
// 0060: the 0057 launch body with one change, the per-tap draft ceiling
// ---------------------------------------------------------------------------
{
  const m57 = readFileSync("supabase/migrations/0057_linkedin_campaign_grant_scope.sql", "utf8");
  const m60 = readFileSync("supabase/migrations/0060_linkedin_campaign_launch_two_drafts.sql", "utf8");
  const launch57 = functionBlock(m57, "launch_linkedin_campaign");
  const launch60 = functionBlock(m60, "launch_linkedin_campaign");
  ok("0060: the launch refuses more than 40 drafts (two per person)", /jsonb_array_length\(p_drafts\) > 40 then\s+return json_build_object\('ok', false, 'reason', 'too-many-drafts'\)/.test(launch60));
  ok("0060: everything else is the 0057 body byte for byte", launch60.replace("jsonb_array_length(p_drafts) > 40", "jsonb_array_length(p_drafts) > 20") === launch57);
  ok("0060: the 0057 launch body is the one S3 froze", sha256(launch57) === sha256(launch60.replace("jsonb_array_length(p_drafts) > 40", "jsonb_array_length(p_drafts) > 20")));
  ok("0060: privileges as 0057, authenticated only", /grant execute on function public\.launch_linkedin_campaign\(text, uuid, jsonb, uuid, text, text, int, int, int, text\) to authenticated;/.test(m60) && !/to service_role/.test(m60));
  ok("0060: touches nothing else (no trigger, no claim, no revoke)", !/create trigger/.test(m60) && !/claim_linkedin/.test(m60) && !/revoke_linkedin_reply_loop/.test(m60.replace(/^--.*$/gm, "")));
  const m59 = readFileSync("supabase/migrations/0059_linkedin_connect_primitive_authority.sql", "utf8");
  ok("0059: the connect claim re-checks the note as body with an empty subject", /approval\.body_hash is distinct from encode\(digest\(coalesce\(outbound\.subject, ''\) \|\| E'\\n' \|\| outbound\.body, 'sha256'\), 'hex'\)/.test(functionBlock(m59, "claim_linkedin_connect", "\\(p_message_id uuid\\)")));
}

// ---------------------------------------------------------------------------
// The sheet: drafts a note and a first message per person, sends only what it showed
// ---------------------------------------------------------------------------
{
  const sheet = readFileSync("src/components/outreach/launch-outreach-sheet.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s(,;{])\/\/.*$/gm, "$1");
  ok("sheet: decides per person through the day plan", /planCampaignDay\(/.test(sheet) && /decisionLabel\(decision\)/.test(sheet));
  ok("sheet: drafts the connection note from the brief and the headline", /draftConnectNote\(\{ name: person\.name, headline: person\.headline \}, brief\)/.test(sheet));
  ok("sheet: the note id is the stable per-campaign id", /connectDraftId\(campaign\.id, person\.candidateId\)/.test(sheet));
  ok("sheet: until the vendor reports a degree, nobody is assumed a connection", /degree: "unknown" as const/.test(sheet));
  ok("sheet: sends exactly the drafts and notes on screen", /drafts: pending,/.test(sheet) && /connects: pendingConnects,/.test(sheet));
  ok("sheet: never sends to someone who opted out", /filter\(\(r\) => !r\.events\.optedOut/.test(sheet));
  ok("sheet: a first message over 80 words is not launched and says so", /!r\.tooLong\)/.test(sheet) && /TARGETING_COPY\.messageTooLong/.test(sheet));
  ok("sheet: shows today's plan and who waits for tomorrow's limit", /launch-day-plan/.test(sheet) && /waiting for tomorrow's limit/.test(sheet));
  ok("sheet: shows the note with its character count against 200", /launch-connect-note/.test(sheet) && /LINKEDIN_CONNECT_NOTE_MAX/.test(sheet));
  ok("sheet: the plan previews the tap; the launch badge tracks both the message and the note", /launched: true,/.test(sheet) && /connectState = draftLaunchState\(connectDraftAsLaunchDraft\(connect\), approvals\)/.test(sheet));
  ok("sheet: a person is pending until both drafts were shown at a tap", /r\.state !== "launched"\)\.map\(\(r\) => r\.draft/.test(sheet) && /r\.connectState !== "launched"\)\.map\(\(r\) => r\.connect\)/.test(sheet));
  ok("sheet: never says vendor, AI or automation", !/vendor|\bAI\b|\bautomation\b|\bbot\b/.test(sheet.replace(/LINKEDIN_VENDOR_PROVIDER/g, "")));
  ok("sheet: no em dash in prose", !/[^"'`]—[^"'`]/.test(sheet));
}

// ---------------------------------------------------------------------------
// Copy and the manifest
// ---------------------------------------------------------------------------
{
  const copy = Object.values(TARGETING_COPY).join("\n");
  ok("copy: no em dash", !copy.includes("—"));
  ok("copy: names no vendor", !/heyreach|unipile|phantombuster|dux-?soup|vendor/i.test(copy));
  ok("copy: never says AI, assistant, automation, bot or model", !/\b(AI|assistant|automation|bot|model)\b/.test(copy));
  ok("copy: the waiting label is the plan's exact words", TARGETING_COPY.waitingForLimit === "Waiting for tomorrow's limit" && TARGETING_COPY.waitingForLimit === LAUNCH_COPY.waitingForLimit);
  ok("copy: the launch description names both drafts and still passes the gate", /connection requests and messages/.test(LAUNCH_COPY.description) && gateOutbound(LAUNCH_COPY.description).pass);
  const labels: CampaignDecision[] = [
    { action: "connect", countsAgainst: "connect", noteMax: 200 },
    { action: "first-message", countsAgainst: "message", trigger: "degree-1", sendAt: NOW, wordMax: 80 },
    { action: "first-message", countsAgainst: "message", trigger: "accepted", sendAt: NOW, wordMax: 80 },
    { action: "reply-loop", countsAgainst: "message" },
    { action: "cancel", countsAgainst: "none", reason: "opted-out" },
    { action: "no-response", countsAgainst: "none", pendingDays: 15 },
    { action: "wait", countsAgainst: "connect", reason: "waiting-for-tomorrow-limit", resumeAt: NOW, next: "connect" },
    { action: "hold", countsAgainst: "none", reason: "not-launched" },
    { action: "hold", countsAgainst: "none", reason: "connect-pending" },
    { action: "hold", countsAgainst: "none", reason: "first-message-sent" },
    { action: "hold", countsAgainst: "none", reason: "kill-switch" },
    { action: "hold", countsAgainst: "none", reason: "sending-off" },
  ];
  ok("copy: every decision has a label a person can read", labels.every((d) => decisionLabel(d).length > 0) && new Set(labels.map(decisionLabel)).size === labels.length - 1);

  ok("manifest: this suite is registered in the application group", testManifest.groups.application.includes("linkedin-targeting"));
}

console.log(`RESULT linkedin-targeting: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
