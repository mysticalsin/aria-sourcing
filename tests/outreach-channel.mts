import assert from "node:assert/strict";
import test from "node:test";

import { preferredOutreachChannel } from "../src/lib/outreach-channel";
import { seatCanSendLive } from "../src/lib/fleet";
import type { AgentSeat } from "../src/lib/types";

test("preferredOutreachChannel prefers Email when present", () => {
  assert.equal(
    preferredOutreachChannel({
      email: "a@example.com",
      linkedinUrl: "https://linkedin.com/in/a",
      phone: "",
    }),
    "Email",
  );
});

test("preferredOutreachChannel uses LinkedIn when email is blank", () => {
  assert.equal(
    preferredOutreachChannel({
      email: "  ",
      linkedinUrl: "https://linkedin.com/in/a",
      phone: "",
    }),
    "LinkedIn",
  );
});

test("preferredOutreachChannel falls through to WhatsApp then Email", () => {
  assert.equal(
    preferredOutreachChannel({ email: "", linkedinUrl: "", phone: "+33123456789" }),
    "WhatsApp",
  );
  assert.equal(preferredOutreachChannel({ email: "", linkedinUrl: "", phone: "" }), "Email");
});

function seat(partial: Partial<AgentSeat>): AgentSeat {
  return {
    id: "seat-1",
    name: "Recruiter",
    operatorEmail: "recruiter@mantu.com",
    provider: "Microsoft Graph",
    status: "active",
    mode: "live",
    domainVerified: false,
    dailyLimit: 40,
    warmup: false,
    warmupStartCap: 5,
    warmupStepPerDay: 5,
    warmupStartedAt: "2026-08-01T00:00:00.000Z",
    minGapMinutes: 3,
    sendWindow: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, timezone: "Europe/Paris" },
    sentToday: 0,
    lastSendAt: null,
    health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: "",
    signature: "",
    connectedAccount: "recruiter@mantu.com",
    createdAt: "2026-08-28T00:00:00.000Z",
    ...partial,
  };
}

test("seatCanSendLive treats live Graph connected mailbox as ready without SPF", () => {
  const ready = seatCanSendLive(seat({ domainVerified: false }));
  assert.equal(ready.ok, true);
});

test("seatCanSendLive still requires SPF for non-Graph API providers", () => {
  const blocked = seatCanSendLive(
    seat({ provider: "SendGrid", domainVerified: false, connectedAccount: "ops@example.com" }),
  );
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Domain not verified/);
});
