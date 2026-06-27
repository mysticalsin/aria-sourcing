/* tests/fleet.mts — area: fleet
 * Tests src/lib/fleet.ts (warm-up caps, remaining capacity, seat health auto-pause,
 * suppression matching, and the allocateBatch coordinator) against real seed data.
 * Run: tsx tests/fleet.mts  (sandbox blocks runtime; assertions hand-verified vs source).
 */
import {
  effectiveDailyCap,
  seatRemainingToday,
  seatHealthStatus,
  suppressionMatch,
  allocateBatch,
  ledgerHasActiveContact,
  recentlyContacted,
  defaultFleetSettings,
} from "../src/lib/fleet";
import { buildSeedState } from "../src/lib/seed";
import { SEED_NOW } from "../src/lib/utils";
import type { AgentSeat, Candidate, SuppressionEntry } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const state = buildSeedState();
const NOW = SEED_NOW.getTime(); // deterministic clock that matches the seed's relative dates
const fs = defaultFleetSettings();

const seat = (id: string): AgentSeat => {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`seat ${id} not found in seed`);
  return s;
};
const cloneSeat = (s: AgentSeat): AgentSeat => JSON.parse(JSON.stringify(s)) as AgentSeat;

/* ---- effectiveDailyCap: warm-up ramp + never exceeds dailyLimit ----------- */
// seat_aisha: warmup true, startCap 12, step 4/day, dailyLimit 40.
function warmSeat(days: number): AgentSeat {
  const s = cloneSeat(seat("seat_aisha"));
  s.warmupStartedAt = new Date(NOW - days * 86_400_000).toISOString();
  return s;
}

ok("cap on day 0 equals warmupStartCap (12)", effectiveDailyCap(warmSeat(0), NOW) === 12);
ok("cap on day 1 ramps to 16", effectiveDailyCap(warmSeat(1), NOW) === 16);
ok("cap on day 5 ramps to 32", effectiveDailyCap(warmSeat(5), NOW) === 32);
ok("cap on day 7 reaches dailyLimit (40, clamped)", effectiveDailyCap(warmSeat(7), NOW) === 40);
ok("cap on day 100 never exceeds dailyLimit (40)", effectiveDailyCap(warmSeat(100), NOW) === 40);

const cap0 = effectiveDailyCap(warmSeat(0), NOW);
const cap5 = effectiveDailyCap(warmSeat(5), NOW);
const cap100 = effectiveDailyCap(warmSeat(100), NOW);
ok("warm-up ramp is monotonically non-decreasing", cap0 <= cap5 && cap5 <= cap100);
ok("every ramped cap stays within [startCap, dailyLimit]", [cap0, cap5, cap100].every((c) => c >= 12 && c <= 40));

// Disabling warm-up returns the full dailyLimit immediately.
const noWarm = warmSeat(0);
noWarm.warmup = false;
ok("non-warmup seat cap === dailyLimit", effectiveDailyCap(noWarm, NOW) === noWarm.dailyLimit);

/* ---- seatRemainingToday --------------------------------------------------- */
ok("remaining = cap - sentToday (warming seat day0: 12-2=10)", seatRemainingToday(warmSeat(0), NOW) === 10);
const overSent = warmSeat(0);
overSent.sentToday = 999;
ok("remaining is clamped at 0 (never negative)", seatRemainingToday(overSent, NOW) === 0);
// Seeded seats at SEED_NOW: maya fully warmed (40-6=34), aisha still warming (32-2=30).
ok("seat_maya remaining today = 34", seatRemainingToday(seat("seat_maya"), NOW) === 34);
ok("seat_aisha (warming) remaining today = 30", seatRemainingToday(seat("seat_aisha"), NOW) === 30);
ok("remaining never exceeds cap", seatRemainingToday(seat("seat_maya"), NOW) <= effectiveDailyCap(seat("seat_maya"), NOW));

/* ---- seatHealthStatus: auto-pause on bounce/complaint spikes -------------- */
const lucasHealth = seatHealthStatus(seat("seat_lucas"), fs); // bounceRate 0.068 > 0.05
ok("seat_lucas shouldPause=true (bounce 0.068 > 0.05 threshold)", lucasHealth.shouldPause === true);
ok("seat_lucas health tone is danger", lucasHealth.tone === "danger");
ok("seat_lucas health label is 'Bounce spike'", lucasHealth.label === "Bounce spike");

const mayaHealth = seatHealthStatus(seat("seat_maya"), fs); // bounceRate 0.015 < 0.03
ok("seat_maya shouldPause=false (healthy)", mayaHealth.shouldPause === false);
ok("seat_maya health tone is success", mayaHealth.tone === "success");

// Complaint spike crosses the (lower) red line even when bounces are fine.
const complainer = cloneSeat(seat("seat_maya"));
complainer.health.complaintRate = 0.002; // > 0.001
const complainerHealth = seatHealthStatus(complainer, fs);
ok("complaint spike pauses seat (0.002 > 0.001)", complainerHealth.shouldPause === true);
ok("complaint spike labelled 'Complaint spike'", complainerHealth.label === "Complaint spike");

// Bounce in the watch band (0.03 < r <= 0.05) warns but does NOT pause.
const watcher = cloneSeat(seat("seat_maya"));
watcher.health.bounceRate = 0.04;
const watcherHealth = seatHealthStatus(watcher, fs);
ok("watch-band bounce warns, no pause", watcherHealth.shouldPause === false && watcherHealth.tone === "warning");

/* ---- suppressionMatch: email + domain + expiry --------------------------- */
const supp = state.suppression;
ok(
  "email suppression matches (case-insensitive)",
  suppressionMatch(supp, { email: "DO-NOT-CONTACT@example.com", linkedinUrl: "" }, NOW)?.type === "email",
);
ok(
  "domain suppression matches any address on the domain",
  suppressionMatch(supp, { email: "jane.doe@competitor-excluded.example", linkedinUrl: "" }, NOW)?.type === "domain",
);
ok(
  "unsubscribed email suppression matches",
  suppressionMatch(supp, { email: "unsub@example.com", linkedinUrl: "" }, NOW)?.type === "email",
);
ok(
  "clean candidate is not suppressed",
  suppressionMatch(supp, { email: "brand.new@freshpool.example", linkedinUrl: "" }, NOW) === null,
);

const past = new Date(NOW - 86_400_000).toISOString();
const future = new Date(NOW + 10 * 86_400_000).toISOString();
const expired: SuppressionEntry[] = [
  { id: "exp1", type: "email", value: "timed@x.com", reason: "temp", source: "test", createdAt: past, expiresAt: past },
];
const stillActive: SuppressionEntry[] = [
  { id: "act1", type: "email", value: "timed@x.com", reason: "temp", source: "test", createdAt: past, expiresAt: future },
];
ok("expired suppression entry does NOT match", suppressionMatch(expired, { email: "timed@x.com", linkedinUrl: "" }, NOW) === null);
ok("unexpired suppression entry matches", suppressionMatch(stillActive, { email: "timed@x.com", linkedinUrl: "" }, NOW)?.id === "act1");

/* ---- allocateBatch INVARIANTS -------------------------------------------- */
const baseCand = state.candidates[0];
function makeFresh(tag: string): Candidate {
  const c = JSON.parse(JSON.stringify(baseCand)) as Candidate;
  c.id = `fresh_${tag}`;
  c.name = `Fresh ${tag}`;
  c.email = `fresh_${tag}@freshpool.example`;
  c.linkedinUrl = `https://www.linkedin.com/in/fresh-${tag}`;
  c.stage = "Sourced";
  c.lastContactedAt = null;
  c.matchScore = 80;
  c.outreachHistory = [];
  c.replyHistory = [];
  c.booking = null;
  c.complianceFlags = {
    doNotContact: false,
    suppressed: false,
    unsubscribed: false,
    gdprExportRequested: false,
    anonymized: false,
    suppressedUntil: null,
  };
  return c;
}

const fresh = ["1", "2", "3", "4", "5"].map(makeFresh);
const freshValidIds = fresh.map((c) => c.id);

const dnc = makeFresh("dnc");
dnc.complianceFlags.doNotContact = true;
const unsub = makeFresh("unsub");
unsub.complianceFlags.unsubscribed = true;
const suppEmail = makeFresh("suppEmail");
suppEmail.email = "do-not-contact@example.com"; // matches seeded email suppression
const suppDomain = makeFresh("suppDomain");
suppDomain.email = "someone@competitor-excluded.example"; // matches seeded domain suppression
const complianceBlockedIds = [dnc.id, unsub.id, suppEmail.id, suppDomain.id];

// Real seeded candidates already contacted (present in the ledger, inside the window).
const contacted = state.candidates.filter((c) => c.lastContactedAt).slice(0, 2);
ok("seed provides already-contacted candidates to exercise de-dupe", contacted.length === 2);

const pool: Candidate[] = [...fresh, dnc, unsub, suppEmail, suppDomain, ...contacted];
const candById = new Map(pool.map((c) => [c.id, c]));

let result: ReturnType<typeof allocateBatch> | null = null;
try {
  result = allocateBatch(pool, state.seats, state.ledger, state.suppression, fs, SEED_NOW);
  ok("allocateBatch runs without throwing", true);
} catch (e) {
  ok("allocateBatch runs without throwing", false);
}

if (result) {
  const r = result;
  const assignedIds = r.assignments.map((a) => a.candidateId);
  const skippedIds = new Set(r.skipped.map((s) => s.candidateId));

  // (a) no candidateId appears in two assignments
  ok("(a) no candidate assigned twice", new Set(assignedIds).size === assignedIds.length);

  // (b) no assignment for a candidate in the ledger / inside the re-contact window
  ok(
    "(b) no assigned candidate is ledger-active or recently contacted",
    assignedIds.every(
      (id) =>
        !ledgerHasActiveContact(state.ledger, id) &&
        !recentlyContacted(state.ledger, id, fs.recontactWindowDays, NOW),
    ),
  );
  ok(
    "(b) no assigned candidate has lastContactedAt inside the re-contact window",
    assignedIds.every((id) => {
      const c = candById.get(id);
      if (!c || !c.lastContactedAt) return true;
      return NOW - new Date(c.lastContactedAt).getTime() >= fs.recontactWindowDays * 86_400_000;
    }),
  );

  // (c) suppressed / doNotContact / unsubscribed candidates are skipped, never assigned
  ok(
    "(c) compliance/suppressed candidates are never assigned",
    complianceBlockedIds.every((id) => !assignedIds.includes(id)),
  );
  ok(
    "(c) compliance/suppressed candidates appear in skipped",
    complianceBlockedIds.every((id) => skippedIds.has(id)),
  );
  ok(
    "(c) already-contacted seed candidates are skipped, not assigned",
    contacted.every((c) => !assignedIds.includes(c.id) && skippedIds.has(c.id)),
  );

  // (d) a paused / auto-paused seat (seat_lucas) gets zero assignments
  ok("seat_lucas is auto-paused by health guardrail", seatHealthStatus(seat("seat_lucas"), fs).shouldPause === true);
  ok("(d) auto-paused seat_lucas receives zero assignments", r.assignments.every((a) => a.seatId !== "seat_lucas"));
  ok(
    "(d) assignments only land on active, healthy seats",
    r.assignments.every((a) => ["seat_maya", "seat_diego", "seat_aisha"].includes(a.seatId)),
  );

  // (e) total assignments <= sum of per-seat remaining capacity
  const capSum = state.seats.reduce((acc, s) => {
    const blocked = s.status !== "active" || seatHealthStatus(s, fs).shouldPause;
    return acc + (blocked ? 0 : seatRemainingToday(s, NOW));
  }, 0);
  ok("(e) total assignments <= fleet remaining capacity", r.assignments.length <= capSum);
  ok("fleetCapacityRemaining = capacity - assignments", r.fleetCapacityRemaining === capSum - r.assignments.length);

  // All five fresh, valid candidates fit within capacity and get assigned.
  ok("all valid fresh candidates are assigned", freshValidIds.every((id) => assignedIds.includes(id)));
  ok("assignment count equals the valid-fresh count (only valid ones allocated)", r.assignments.length === freshValidIds.length);

  // Every assignment references a real seat and a pooled candidate.
  const seatIds = new Set(state.seats.map((s) => s.id));
  ok(
    "every assignment references a real seat + pooled candidate",
    r.assignments.every((a) => seatIds.has(a.seatId) && candById.has(a.candidateId)),
  );
} else {
  ok("allocateBatch produced a result", false);
}

/* ---- summary ------------------------------------------------------------- */
console.log(`RESULT fleet: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
