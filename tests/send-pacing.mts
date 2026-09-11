/* tests/send-pacing.mts — area: fleet / anti-bot
 * Unit checks for evaluateSendPace + LINKEDIN_BROWSER_SEAT_DEFAULTS.
 * Run: tsx tests/send-pacing.mts
 */
import {
  evaluateSendPace,
  effectiveMinGapMinutes,
  LINKEDIN_BROWSER_SEAT_DEFAULTS,
  pacingJitterMinutes,
} from "../src/lib/send-pacing";
import { defaultFleetSettings, defaultSendWindow } from "../src/lib/fleet";
import type { AgentSeat } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function baseSeat(partial: Partial<AgentSeat> = {}): AgentSeat {
  const now = new Date("2026-06-26T12:00:00.000Z");
  return {
    id: "seat_li_test",
    name: "LI Test",
    operatorEmail: "li@example.test",
    provider: "LinkedIn Browser Computer",
    status: "active",
    mode: "live",
    domainVerified: true,
    dailyLimit: LINKEDIN_BROWSER_SEAT_DEFAULTS.dailyLimit,
    warmup: LINKEDIN_BROWSER_SEAT_DEFAULTS.warmup,
    warmupStartCap: LINKEDIN_BROWSER_SEAT_DEFAULTS.warmupStartCap,
    warmupStepPerDay: LINKEDIN_BROWSER_SEAT_DEFAULTS.warmupStepPerDay,
    warmupStartedAt: new Date(now.getTime() - 20 * 86_400_000).toISOString(),
    minGapMinutes: LINKEDIN_BROWSER_SEAT_DEFAULTS.minGapMinutes,
    sendWindow: defaultSendWindow("UTC"),
    sentToday: 0,
    lastSendAt: null,
    health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: "",
    signature: "",
    connectedAccount: "",
    createdAt: now.toISOString(),
    linkedinDeliveryBackend: "browser-computer",
    ...partial,
  };
}

const settings = { ...defaultFleetSettings(), enforceBusinessHours: true, jitter: false };
// Noon UTC Friday — inside default 8–18 window if local hours match; force window days + hours via seat.
const seat = baseSeat({
  sendWindow: { startHour: 0, endHour: 23, timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6] },
});
const now = new Date("2026-06-26T12:00:00.000Z");

ok("defaults dailyLimit is conservative (15)", LINKEDIN_BROWSER_SEAT_DEFAULTS.dailyLimit === 15);
ok("defaults minGapMinutes is 18", LINKEDIN_BROWSER_SEAT_DEFAULTS.minGapMinutes === 18);
ok("ok when fresh seat", evaluateSendPace({ seat, settings, now }).ok === true);

const paused = baseSeat({ status: "paused", sendWindow: seat.sendWindow });
ok("seat_paused when not active", evaluateSendPace({ seat: paused, settings, now }).reason === "seat_paused");

const capped = baseSeat({
  sentToday: 100,
  warmup: false,
  dailyLimit: 15,
  sendWindow: seat.sendWindow,
});
ok("daily_cap when sentToday >= cap", evaluateSendPace({ seat: capped, settings, now }).reason === "daily_cap");

const recent = baseSeat({
  lastSendAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
  minGapMinutes: 18,
  sendWindow: seat.sendWindow,
});
const gap = evaluateSendPace({ seat: recent, settings: { ...settings, jitter: false }, now });
ok("min_gap when last send too recent", gap.ok === false && gap.reason === "min_gap");

const unhealthy = evaluateSendPace({ seat, settings, now, sessionHealthy: false });
ok("session_unhealthy when flagged", unhealthy.reason === "session_unhealthy");

const unverified = evaluateSendPace({ seat, settings, now, sessionHealthy: null });
ok("session_unhealthy when null (unverified)", unverified.reason === "session_unhealthy");
ok(
  "null session detail mentions unverified",
  Boolean(unverified.detail?.toLowerCase().includes("unverified")),
);

const outside = baseSeat({
  sendWindow: { startHour: 8, endHour: 9, timezone: "UTC", days: [1, 2, 3, 4, 5] },
});
// Saturday 2026-06-27 — not in weekday window
const sat = new Date("2026-06-27T12:00:00.000Z");
const bh = evaluateSendPace({
  seat: outside,
  settings: { ...settings, enforceBusinessHours: true },
  now: sat,
});
ok("business_hours when outside window", bh.ok === false && bh.reason === "business_hours");

ok("jitter is deterministic", pacingJitterMinutes("abc", 5) === pacingJitterMinutes("abc", 5));
ok(
  "effectiveMinGap >= base when jitter on",
  effectiveMinGapMinutes(seat, { ...settings, jitter: true }) >= seat.minGapMinutes,
);

console.log(`send-pacing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
