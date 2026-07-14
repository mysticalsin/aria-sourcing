import { gateOutbound, dedupeHash, inQuietHours, nextSendTime, replyDelayMs, DEFAULT_QUIET_HOURS } from "../src/lib/gate";
import { assessWhatsAppDispatch, normalizeWhatsAppAddress } from "../src/lib/whatsapp-policy";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } }

// ---------------------------------------------------------------------------
// Adversarial fixtures: every one of these is machine output and MUST block.
// ---------------------------------------------------------------------------
const MUST_BLOCK: string[] = [
  // AI self-disclosure
  "As an AI, I think you'd be a great fit for this role.",
  "As an artificial intelligence assistant I found your profile interesting.",
  "I'm an AI assistant reaching out about a Staff Engineer role.",
  "I am a language model helping with recruitment at our company.",
  "I'm a bot working with the talent team, and your profile stood out.",
  "I am an LLM tasked with finding great engineers like you.",
  "This is an AI-generated message about an exciting opportunity.",
  "My training data suggests you have strong React experience.",
  "My knowledge cutoff prevents me from seeing your latest role, but let's talk!",
  "Given my programming, I believe this role matches your background.",
  "I'm a virtual assistant for the recruiting team here.",
  "I am a digital assistant and I came across your GitHub profile.",

  // Status / progress narration — "an action getting done"
  "Processing your request...",
  "Processing the message now, thanks for your patience.",
  "Analyzing your profile to find the best match.",
  "Calculating the response...",
  "Generating your response now.",
  "Retrieving the data you asked about.",
  "Fetching your profile details, one sec.",
  "Please wait while I look into that for you.",
  "Please hold on while I check the salary range.",
  "One moment while I pull up the job description.",
  "Thinking...",
  "thinking…",
  "Processing...",
  "Calculating…",
  "Working...",
  "Searching...",
  "Loading...",
  "Typing...",
  "Task completed successfully.",
  "The action has been performed successfully.",
  "Your request has been executed.",
  "Operation finished.",
  "I have completed the task you asked about.",
  "I've now finished your search and found 5 candidates.",
  "Here is the result: the role pays 95k.",
  "Here's your generated response about the position.",

  // Leaked structure
  "```json\n{\"reply\": \"sounds good\"}\n```",
  "Sure! ```python\nprint('hi')``` — does that help?",
  '{"drafts": [{"candidateId": "abc", "subject": "Hi"}]}',
  '[{"role": "user", "content": "hello"}]',
  "<tool_call>search_candidates</tool_call> found you on GitHub.",
  "<thinking>I should reply warmly</thinking> Hi Marco, thanks!",
  "<function_call>send_message</function_call>",
  "assistant: Thanks for your reply, Marco!",
  "System: the candidate has responded positively.",

  // Unfilled templates / placeholders
  "Hi {{first_name}}, I saw your work at {{company}} and was impressed.",
  "Hello [CANDIDATE NAME], we have a role at [COMPANY] for you.",
  "Dear [INSERT NAME HERE], your experience is impressive.",
  "Hi <NAME>, are you open to new roles?",
  "Salary range is [TODO: confirm with HR] for this position.",

  // Meta about instructions / capabilities
  "Based on the instructions I received, I should tell you about this role.",
  "Based on your prompt, here are the details of the position.",
  "According to my guidelines, I can share the salary range.",
  "I don't have access to real-time compensation data, but the role is great.",
  "I do not have the ability to schedule calls, but someone will reach out.",

  // Fragment leaks
  "",
  "   ",
  "ok",
];

for (const [i, msg] of MUST_BLOCK.entries()) {
  const v = gateOutbound(msg);
  ok(`block #${i}: ${msg.slice(0, 48) || "(empty)"}`, v.pass === false);
}

// ---------------------------------------------------------------------------
// Legit human recruiter messages: every one MUST pass.
// ---------------------------------------------------------------------------
const MUST_PASS: string[] = [
  "Hi Marco, I came across your work on the Delta framework and thought of a Staff Engineer role we're filling. Open to a quick chat this week?",
  "Thanks for getting back to me! Yes, the role is fully remote within the EU. Would Thursday afternoon work for a call?",
  "Good question. The team is 8 engineers, mostly backend, and they ship weekly. Happy to share more on a call.",
  "Totally understand, timing matters. I'll check back in a few months. Good luck with the launch!",
  "The range for this role is 90-110k depending on experience. Does that work as a starting point?",
  "Salut Marie, j'ai vu ton profil et ton travail sur l'app mobile de Doctolib. On cherche une lead dev pour une scale-up a Paris. Partante pour en discuter?",
  "Hey! Saw your reply. The interview process is two calls plus a small take-home, usually done inside two weeks.",
  "No worries at all. If anyone in your network is looking, I'd appreciate an intro. Have a great week!",
];

for (const [i, msg] of MUST_PASS.entries()) {
  const v = gateOutbound(msg);
  ok(`pass #${i}: ${msg.slice(0, 48)}`, v.pass === true);
  if (!v.pass) console.log("  reasons:", (v as { reasons: string[] }).reasons.join(", "));
}

// Soft transforms still apply on passing messages (AI-isms cleaned, not blocked).
{
  const v = gateOutbound("I wanted to reach out because we could leverage your robust experience — the team would love it.");
  ok("soft: AI-isms cleaned but message passes", v.pass === true);
  if (v.pass) {
    ok("soft: 'leverage' replaced", !/leverage/i.test(v.text));
    ok("soft: em-dash removed", !v.text.includes("—"));
    ok("soft: transforms reported", v.transformed.length >= 2);
  }
}

// Blocked messages keep transformed text for the review queue.
{
  const v = gateOutbound("As an AI, I leverage cutting-edge matching.");
  ok("block keeps text for review", v.pass === false && v.text.length > 0);
  ok("block reports ai-disclosure", !v.pass && (v as { reasons: string[] }).reasons.includes("ai-disclosure"));
}

// ---------------------------------------------------------------------------
// Dedupe hash
// ---------------------------------------------------------------------------
{
  const a = dedupeHash("cand-1", "WhatsApp", "Hi Marco, quick question about your availability.");
  const b = dedupeHash("cand-1", "WhatsApp", "  hi   marco, quick question about your availability. ");
  const c = dedupeHash("cand-1", "WhatsApp", "Hi Marco, different message entirely.");
  const d = dedupeHash("cand-2", "WhatsApp", "Hi Marco, quick question about your availability.");
  const e = dedupeHash("cand-1", "Email", "Hi Marco, quick question about your availability.");
  ok("dedupe: whitespace/case normalized to same hash", a === b);
  ok("dedupe: different body differs", a !== c);
  ok("dedupe: different candidate differs", a !== d);
  ok("dedupe: different channel differs", a !== e);
  ok("dedupe: hex sha256 shape", /^[0-9a-f]{64}$/.test(a));
}

// ---------------------------------------------------------------------------
// Quiet hours + pacing
// ---------------------------------------------------------------------------
{
  const at = (h: number, m = 0) => { const d = new Date(2026, 6, 9); d.setHours(h, m, 0, 0); return d; };
  ok("quiet: 23:00 inside 21-8 window", inQuietHours(at(23)) === true);
  ok("quiet: 03:00 inside 21-8 window", inQuietHours(at(3)) === true);
  ok("quiet: 12:00 outside 21-8 window", inQuietHours(at(12)) === false);
  ok("quiet: 08:00 is outside (exclusive end)", inQuietHours(at(8)) === false);
  ok("quiet: 21:00 is inside (inclusive start)", inQuietHours(at(21)) === true);
  ok("quiet: non-wrapping window works", inQuietHours(at(13), { start: 12, end: 14 }) === true);

  const delay1 = replyDelayMs("msg-1");
  ok("pacing: deterministic for same seed", delay1 === replyDelayMs("msg-1"));
  ok("pacing: differs across seeds", delay1 !== replyDelayMs("msg-2"));
  ok("pacing: within [90s, 480s]", delay1 >= 90_000 && delay1 <= 480_000);

  const daytime = at(14);
  const sendA = nextSendTime(daytime, "msg-1");
  ok("pacing: daytime send lands 90s-480s later", sendA.getTime() - daytime.getTime() >= 90_000 && sendA.getTime() - daytime.getTime() <= 480_000);
  ok("pacing: daytime send not in quiet hours", !inQuietHours(sendA));

  const night = at(23, 30);
  const sendB = nextSendTime(night, "msg-1");
  ok("pacing: night send deferred out of quiet hours", !inQuietHours(sendB));
  ok("pacing: night send lands after quiet end", sendB.getHours() >= DEFAULT_QUIET_HOURS.end && sendB.getHours() < DEFAULT_QUIET_HOURS.start);
  ok("pacing: night send is in the future", sendB.getTime() > night.getTime());
}

// Robustness: never throws.
{
  let threw = false;
  try {
    gateOutbound(null as unknown as string);
    gateOutbound(undefined as unknown as string);
    gateOutbound(" �" + "x".repeat(100_000));
  } catch { threw = true; }
  ok("robust: no throw on odd input", !threw);
}

// ---------------------------------------------------------------------------
// WhatsApp policy — carrier delivery is legal only with a current permission.
// Free-form copy is a reply inside the 24-hour customer-service window; new
// business contact must use an approved template.
// ---------------------------------------------------------------------------
{
  const now = new Date("2026-07-09T14:00:00.000Z");
  const optedIn = { status: "opted_in" as const, recipientAddress: "33612345678", recordedAt: "2026-07-01T09:00:00.000Z" };

  ok("WhatsApp policy: normalizes E.164 punctuation", normalizeWhatsAppAddress("+33 (6) 12 34 56 78") === "33612345678");
  ok("WhatsApp policy: rejects malformed recipient", normalizeWhatsAppAddress("not-a-number") === null);
  ok("WhatsApp policy: rejects embedded or repeated plus signs", normalizeWhatsAppAddress("+33+6 12 34 56 78") === null);

  const reply = assessWhatsAppDispatch({
    now,
    recipientAddress: "+33612345678",
    type: "candidate_reply",
    permission: optedIn,
    inboundReceivedAt: "2026-07-09T13:30:00.000Z",
  });
  ok("WhatsApp policy: permits opted-in reply inside 24 hours", reply.allow === true);

  const noPermission = assessWhatsAppDispatch({
    now,
    recipientAddress: "33612345678",
    type: "candidate_reply",
    permission: null,
    inboundReceivedAt: "2026-07-09T13:30:00.000Z",
  });
  ok("WhatsApp policy: blocks reply without recorded opt-in", noPermission.allow === false && noPermission.reason === "missing-opt-in");

  const optOut = assessWhatsAppDispatch({
    now,
    recipientAddress: "33612345678",
    type: "approved_template",
    permission: { ...optedIn, status: "opted_out" as const },
    template: { name: "role_intro", language: "en_US", approved: true },
  });
  ok("WhatsApp policy: blocks opted-out recipient even for templates", optOut.allow === false && optOut.reason === "opted-out");

  const staleReply = assessWhatsAppDispatch({
    now,
    recipientAddress: "33612345678",
    type: "candidate_reply",
    permission: optedIn,
    inboundReceivedAt: "2026-07-08T13:59:59.000Z",
  });
  ok("WhatsApp policy: blocks free-form reply outside 24 hours", staleReply.allow === false && staleReply.reason === "reply-window-closed");

  const exactBoundary = assessWhatsAppDispatch({
    now,
    recipientAddress: "33612345678",
    type: "candidate_reply",
    permission: optedIn,
    inboundReceivedAt: "2026-07-08T14:00:00.000Z",
  });
  ok("WhatsApp policy: fails closed at the exact 24-hour boundary", exactBoundary.allow === false && exactBoundary.reason === "reply-window-closed");

  const missingTemplate = assessWhatsAppDispatch({
    now,
    recipientAddress: "33612345678",
    type: "approved_template",
    permission: optedIn,
  });
  ok("WhatsApp policy: blocks business initiation without an approved template reference", missingTemplate.allow === false && missingTemplate.reason === "template-required");

  const template = assessWhatsAppDispatch({
    now,
    recipientAddress: "33612345678",
    type: "approved_template",
    permission: optedIn,
    template: { name: "role_intro", language: "en_US", approved: true },
  });
  ok("WhatsApp policy: permits opted-in approved template", template.allow === true);

  const unknownTemplate = assessWhatsAppDispatch({
    now,
    recipientAddress: "33612345678",
    type: "approved_template",
    permission: optedIn,
    template: { name: "invented_template", language: "en_US", approved: false },
  });
  ok("WhatsApp policy: blocks a template outside the trusted catalog", unknownTemplate.allow === false && unknownTemplate.reason === "template-not-approved");
}

console.log(`RESULT gate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
