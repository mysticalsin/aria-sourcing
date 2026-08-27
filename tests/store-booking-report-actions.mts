import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHistoricalDemoSeedState } from "../src/lib/seed";
import {
  createBookingReportActions,
  type BookingReportActionDependencies,
} from "../src/lib/store/booking-report-actions";
import type { Activity, HermesState } from "../src/lib/types";

const storeSource = readFileSync(
  new URL("../src/lib/store.ts", import.meta.url),
  "utf8",
);
const bookingReportActionsSource = readFileSync(
  new URL("../src/lib/store/booking-report-actions.ts", import.meta.url),
  "utf8",
);
const contractsSource = readFileSync(
  new URL("../src/lib/store/contracts.ts", import.meta.url),
  "utf8",
);
const bookingCalendarSource = readFileSync(
  new URL("../src/components/calendar/booking-calendar.tsx", import.meta.url),
  "utf8",
);
const candidateDrawerSource = readFileSync(
  new URL("../src/components/candidates/candidate-drawer.tsx", import.meta.url),
  "utf8",
);
const campaignPageSource = readFileSync(
  new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url),
  "utf8",
);
const calendarPageSource = readFileSync(
  new URL("../src/app/calendar/page.tsx", import.meta.url),
  "utf8",
);
const ariaLiveSource = readFileSync(
  new URL("../src/lib/demo/aria-live.ts", import.meta.url),
  "utf8",
);
const skillDecisionSources = [
  "../src/components/reports/skill-update-card.tsx",
  "../src/app/skills/page.tsx",
  "../src/components/skills/learning-session.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

test("booking and report actions are React-free and wired through one stable factory", () => {
  assert.doesNotMatch(bookingReportActionsSource, /["']use client["']/);
  assert.doesNotMatch(bookingReportActionsSource, /from ["']react["']/);
  assert.match(
    storeSource,
    /createBookingReportActions\([\s\S]*?commit,[\s\S]*?currentState: \(\) => stateRef\.current,[\s\S]*?workspaceEffectAllowed,[\s\S]*?workspaceFetch,[\s\S]*?liveCalendarEnabled: supabaseEnabled,[\s\S]*?emitBooking: emit,[\s\S]*?\),\n\s*\[[\s\S]*?commit,[\s\S]*?workspaceEffectAllowed,[\s\S]*?workspaceFetch,[\s\S]*?\],/,
  );
  assert.equal((storeSource.match(/const createBookingFor = useCallback/g) ?? []).length, 0);
  assert.equal((storeSource.match(/const updateBooking = useCallback/g) ?? []).length, 0);
  assert.equal((storeSource.match(/const generateReport = useCallback/g) ?? []).length, 0);
  assert.equal((storeSource.match(/const setSkillUpdateStatus = useCallback/g) ?? []).length, 0);
  assert.doesNotMatch(candidateDrawerSource, /Teams \+ Cal\.com links generated/);
  assert.doesNotMatch(campaignPageSource, /Teams \+ Cal\.com links generated/);
  assert.match(calendarPageSource, /preview\?\.booking\.calendarSync/);
  assert.match(calendarPageSource, /bookingCalendarSummary\(preview\.booking\)/);
});

test("booking and report callers handle rejected mutations before success", () => {
  assert.match(bookingCalendarSource, /const result = actions\.updateBooking\(booking\.id, \{ status \}\);[\s\S]*?if \(!result\.ok\)/);
  assert.match(ariaLiveSource, /const report = actions\.generateReport\(campaign\.id\);[\s\S]*?if \(!report\)[\s\S]*?fail\(/);
});

test("a learning decision is one validated commit and every caller handles rejection", () => {
  assert.match(contractsSource, /setSkillUpdateStatus:[\s\S]*?\) => boolean;/);
  for (const source of skillDecisionSources) {
    assert.doesNotMatch(source, /actions\.acceptSkillLearning\(/);
    assert.match(source, /const (?:updated|accepted|rejected) = actions\.setSkillUpdateStatus/);
  }
});

type ActivityDraft = Parameters<BookingReportActionDependencies["makeActivity"]>[0];

function bookingFixture(): HermesState {
  const state = structuredClone(buildHistoricalDemoSeedState());
  const campaign = state.campaigns[0];
  assert.ok(campaign, "seed campaign is required");
  const candidate = state.candidates.find((item) => item.campaignId === campaign.id);
  assert.ok(candidate, "seed candidate is required");
  return {
    ...state,
    activeCampaignId: campaign.id,
    bookings: [],
    wins: [],
    reports: [],
    campaigns: state.campaigns.map((item) =>
      item.id === campaign.id ? { ...item, skillUpdates: [] } : item,
    ),
    candidates: state.candidates.map((item) =>
      item.id === candidate.id
        ? {
            ...item,
            booking: null,
            stage: "Interested",
            complianceFlags: {
              ...item.complianceFlags,
              doNotContact: false,
              suppressed: false,
              unsubscribed: false,
              anonymized: false,
            },
          }
        : item,
    ),
  };
}

function liveCalendarState(
  provider: "Gmail API" | "Microsoft Graph" = "Gmail API",
  id = "11111111-1111-4111-8111-111111111111",
): HermesState {
  const state = bookingFixture();
  const seat = state.seats[0];
  assert.ok(seat, "seed calendar seat is required");
  return {
    ...state,
    seats: [{ ...seat, id, provider, status: "active", mode: "live" }],
  };
}

function futureBookingRange(daysFromNow = 30): {
  startTime: string;
  endTime: string;
} {
  const start = new Date(Date.now() + daysFromNow * 86_400_000);
  start.setUTCSeconds(0, 0);
  return {
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
  };
}

function createHarness(options: {
  state?: HermesState;
  commitAllowed?: boolean;
  workspaceAllowed?: boolean;
  bookingAllowed?: boolean;
  bookingAllowedAfterFetch?: boolean;
  learningAllowed?: boolean;
  liveCalendarEnabled?: boolean;
  fetchBody?: unknown;
  fetchStatus?: number;
  fetchError?: Error;
  afterFetch?: (state: HermesState) => HermesState;
} = {}) {
  let state = structuredClone(options.state ?? bookingFixture());
  let bookingAllowed = options.bookingAllowed ?? true;
  let commitCalls = 0;
  let fetchCalls = 0;
  let recomputeCalls = 0;
  const events: Array<{ kind: "book"; candidateName: string; campaignId: string }> = [];
  const activityDrafts: ActivityDraft[] = [];

  const dependencies: BookingReportActionDependencies = {
    commit: (update) => {
      commitCalls += 1;
      if (options.commitAllowed === false) return false;
      state = update(state);
      return true;
    },
    currentState: () => state,
    workspaceEffectAllowed: () => options.workspaceAllowed ?? true,
    bookingMutationAllowed: () => bookingAllowed,
    learningMutationAllowed: () => options.learningAllowed ?? true,
    workspaceFetch: async () => {
      fetchCalls += 1;
      if (options.bookingAllowedAfterFetch !== undefined) {
        bookingAllowed = options.bookingAllowedAfterFetch;
      }
      if (options.afterFetch) state = options.afterFetch(state);
      if (options.fetchError) throw options.fetchError;
      return new Response(JSON.stringify(options.fetchBody ?? {
        status: "created",
        eventId: "evt_default",
        link: "https://calendar.example.test/event",
      }), {
        status: options.fetchStatus ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    liveCalendarEnabled: options.liveCalendarEnabled ?? false,
    makeActivity: (draft) => {
      activityDrafts.push(draft);
      return {
        ...draft,
        id: `activity_${activityDrafts.length}`,
        createdAt: draft.createdAt ?? "2026-07-14T00:00:00.000Z",
      } satisfies Activity;
    },
    withActivity: (current, activity, campaignId) => ({
      ...current,
      campaigns: campaignId
        ? current.campaigns.map((campaign) =>
            campaign.id === campaignId
              ? { ...campaign, activities: [activity, ...campaign.activities] }
              : campaign,
          )
        : current.campaigns,
      activities: [activity, ...current.activities],
    }),
    recomputeMetrics: (current) => {
      recomputeCalls += 1;
      return current;
    },
    emitBooking: (event) => events.push(event),
  };

  return {
    actions: createBookingReportActions(dependencies),
    activityDrafts,
    events,
    get commitCalls() {
      return commitCalls;
    },
    get fetchCalls() {
      return fetchCalls;
    },
    get recomputeCalls() {
      return recomputeCalls;
    },
    get state() {
      return state;
    },
  };
}

function fixtureIds(state: HermesState) {
  const campaign = state.campaigns.find((item) => item.id === state.activeCampaignId);
  assert.ok(campaign);
  const candidate = state.candidates.find((item) => item.campaignId === campaign.id && !item.booking);
  assert.ok(candidate);
  return { campaign, candidate };
}

test("runtime booking creation emits only after an accepted state transition", async () => {
  const rejected = createHarness({ commitAllowed: false });
  const { candidate } = fixtureIds(rejected.state);
  const failed = await rejected.actions.createBookingFor(candidate.id);
  assert.equal(failed.ok, false);
  assert.equal(rejected.state.bookings.length, 0);
  assert.equal(rejected.events.length, 0);

  const accepted = createHarness();
  const acceptedIds = fixtureIds(accepted.state);
  const result = await accepted.actions.createBookingFor(acceptedIds.candidate.id);
  assert.equal(result.ok, true);
  assert.equal(accepted.state.bookings.length, 1);
  assert.equal(
    accepted.state.candidates.find((item) => item.id === acceptedIds.candidate.id)?.booking?.id,
    result.ok ? result.booking.id : null,
  );
  assert.equal(accepted.events.length, 1);
  assert.doesNotMatch(accepted.activityDrafts.at(-1)?.notes ?? "", /links generated/i);
  assert.match(
    accepted.activityDrafts.at(-1)?.notes ?? "",
    /Meeting link pending calendar provider confirmation\./,
  );

  const duplicate = await accepted.actions.createBookingFor(acceptedIds.candidate.id);
  assert.equal(duplicate.ok, false);
  assert.equal(accepted.state.bookings.length, 1);
  assert.equal(accepted.events.length, 1);
});

test("runtime action capabilities block viewers before state or network work", async () => {
  const harness = createHarness({ bookingAllowed: false, learningAllowed: false });
  const { campaign, candidate } = fixtureIds(harness.state);
  assert.equal((await harness.actions.createBookingFor(candidate.id)).ok, false);
  assert.equal(harness.actions.generateReport(campaign.id), null);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.fetchCalls, 0);
});

test("runtime booking creation rejects invalid, past, and unknown-interviewer slots", async () => {
  const harness = createHarness();
  const { candidate } = fixtureIds(harness.state);
  const invalid = await harness.actions.createBookingFor(candidate.id, {
    startTime: "not-a-date",
  });
  assert.equal(invalid.ok, false);
  const past = await harness.actions.createBookingFor(candidate.id, {
    startTime: "2020-01-01T10:00:00.000Z",
  });
  assert.equal(past.ok, false);
  const unknown = await harness.actions.createBookingFor(candidate.id, {
    interviewerName: "Unknown Interviewer",
  });
  assert.equal(unknown.ok, false);
  assert.equal(harness.commitCalls, 0);
});

test("runtime booking creation blocks every candidate contact prohibition", async () => {
  for (const flag of [
    "doNotContact",
    "suppressed",
    "unsubscribed",
    "anonymized",
  ] as const) {
    const state = bookingFixture();
    const { candidate } = fixtureIds(state);
    state.candidates = state.candidates.map((item) =>
      item.id === candidate.id
        ? {
            ...item,
            complianceFlags: { ...item.complianceFlags, [flag]: true },
          }
        : item,
    );
    const harness = createHarness({ state });
    const result = await harness.actions.createBookingFor(candidate.id);
    assert.equal(result.ok, false, `${flag} must block booking`);
    assert.equal(harness.commitCalls, 0);
    assert.equal(harness.fetchCalls, 0);
  }
});

test("runtime booking creation blocks suppression and revalidates it after calendar I/O", async () => {
  const suppressedState = bookingFixture();
  const suppressedIds = fixtureIds(suppressedState);
  suppressedState.candidates = suppressedState.candidates.map((item) =>
    item.id === suppressedIds.candidate.id
      ? { ...item, complianceFlags: { ...item.complianceFlags, suppressed: true } }
      : item,
  );
  const suppressed = createHarness({ state: suppressedState });
  const initial = await suppressed.actions.createBookingFor(suppressedIds.candidate.id);
  assert.equal(initial.ok, false);
  assert.equal(suppressed.commitCalls, 0);

  const afterFetch = createHarness({
    liveCalendarEnabled: true,
    state: liveCalendarState(),
    afterFetch: (current) => {
      const ids = fixtureIds(current);
      return {
        ...current,
        candidates: current.candidates.map((item) =>
          item.id === ids.candidate.id
            ? { ...item, complianceFlags: { ...item.complianceFlags, suppressed: true } }
            : item,
        ),
      };
    },
  });
  const afterFetchIds = fixtureIds(afterFetch.state);
  const stale = await afterFetch.actions.createBookingFor(afterFetchIds.candidate.id);
  assert.equal(stale.ok, false);
  assert.equal(afterFetch.fetchCalls, 1);
  assert.equal(afterFetch.state.bookings.length, 0);
  assert.equal(afterFetch.events.length, 0);
});

test("runtime booking creation rebinds authority and candidate campaign after calendar I/O", async () => {
  const revoked = createHarness({
    liveCalendarEnabled: true,
    bookingAllowedAfterFetch: false,
    state: liveCalendarState(),
  });
  const revokedIds = fixtureIds(revoked.state);
  const revokedResult = await revoked.actions.createBookingFor(revokedIds.candidate.id);
  assert.equal(revokedResult.ok, false);
  assert.match(
    revokedResult.ok ? "" : revokedResult.error,
    /reconciliation is required; do not retry/i,
  );
  assert.equal(revoked.state.bookings.length, 0);

  const moved = createHarness({
    liveCalendarEnabled: true,
    state: liveCalendarState(
      "Microsoft Graph",
      "22222222-2222-4222-8222-222222222222",
    ),
    afterFetch: (current) => {
      const ids = fixtureIds(current);
      const destination = current.campaigns.find((item) => item.id !== ids.campaign.id);
      assert.ok(destination);
      return {
        ...current,
        candidates: current.candidates.map((item) =>
          item.id === ids.candidate.id
            ? { ...item, campaignId: destination.id }
            : item,
        ),
      };
    },
  });
  const movedIds = fixtureIds(moved.state);
  const movedResult = await moved.actions.createBookingFor(movedIds.candidate.id);
  assert.equal(movedResult.ok, false);
  assert.match(
    movedResult.ok ? "" : movedResult.error,
    /reconciliation is required; do not retry/i,
  );
  assert.equal(moved.state.bookings.length, 0);

  const stageChanged = createHarness({
    liveCalendarEnabled: true,
    state: liveCalendarState(
      "Gmail API",
      "44444444-4444-4444-8444-444444444444",
    ),
    afterFetch: (current) => {
      const ids = fixtureIds(current);
      return {
        ...current,
        candidates: current.candidates.map((item) =>
          item.id === ids.candidate.id
            ? {
                ...item,
                stage: "Rejected",
                rejectionReason: "Human decision during provider I/O",
              }
            : item,
        ),
      };
    },
  });
  const stageIds = fixtureIds(stageChanged.state);
  const stageResult = await stageChanged.actions.createBookingFor(stageIds.candidate.id);
  assert.equal(stageResult.ok, false);
  assert.match(
    stageResult.ok ? "" : stageResult.error,
    /reconciliation is required; do not retry/i,
  );
  assert.equal(
    stageChanged.state.candidates.find((item) => item.id === stageIds.candidate.id)?.stage,
    "Rejected",
  );
  assert.equal(stageChanged.state.bookings.length, 0);
});

test("runtime booking creation rejects a slot claimed during calendar I/O", async () => {
  const { startTime, endTime } = futureBookingRange();
  const initial = liveCalendarState(
    "Gmail API",
    "33333333-3333-4333-8333-333333333333",
  );
  const harness = createHarness({
    liveCalendarEnabled: true,
    state: initial,
    afterFetch: (current) => {
      const ids = fixtureIds(current);
      const interviewer = current.interviewers.find((item) => item.active);
      const otherCandidate = current.candidates.find(
        (item) => item.campaignId === ids.campaign.id && item.id !== ids.candidate.id,
      );
      assert.ok(interviewer);
      assert.ok(otherCandidate);
      return {
        ...current,
        bookings: [
          {
            id: "bk_concurrent",
            candidateId: otherCandidate.id,
            campaignId: ids.campaign.id,
            candidateName: otherCandidate.name,
            role: ids.campaign.title,
            startTime,
            endTime,
            timezone: otherCandidate.timezone,
            interviewer: interviewer.name,
            interviewerEmail: interviewer.email,
            teamsLink: "",
            calLink: "",
            status: "Confirmed",
            agenda: [],
            createdAt: new Date().toISOString(),
          },
          ...current.bookings,
        ],
      };
    },
  });
  const { candidate } = fixtureIds(harness.state);
  const result = await harness.actions.createBookingFor(candidate.id, { startTime });
  assert.equal(result.ok, false);
  assert.match(
    result.ok ? "" : result.error,
    /reconciliation is required; do not retry/i,
  );
  assert.equal(harness.state.bookings.length, 1);
  assert.equal(harness.events.length, 0);
});

test("runtime live calendar success reaches the stored booking and both email previews", async () => {
  const harness = createHarness({ state: liveCalendarState(), liveCalendarEnabled: true });
  const { candidate } = fixtureIds(harness.state);
  const result = await harness.actions.createBookingFor(candidate.id);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.booking.calLink, "https://calendar.example.test/event");
  assert.match(
    harness.activityDrafts.at(-1)?.notes ?? "",
    /Calendar event and link confirmed by the connected provider\./,
  );
  assert.match(result.prepEmail, /https:\/\/calendar\.example\.test\/event/);
  assert.match(result.confirmationEmail, /https:\/\/calendar\.example\.test\/event/);
});

test("live calendar refuses Booked without a Graph/Gmail seat", async () => {
  const state = bookingFixture();
  state.seats = state.seats.map((seat) => ({ ...seat, status: "paused", mode: "dry-run" }));
  const harness = createHarness({ state, liveCalendarEnabled: true });
  const { candidate } = fixtureIds(harness.state);
  const result = await harness.actions.createBookingFor(candidate.id);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /Connect a live Gmail or Microsoft Graph calendar seat/i);
  assert.equal(harness.commitCalls, 0);
});

test("Graph booking requires a Teams join URL before committing Booked", async () => {
  const missing = createHarness({
    state: liveCalendarState("Microsoft Graph"),
    liveCalendarEnabled: true,
    fetchBody: { status: "created", eventId: "evt-graph-1", link: null },
  });
  const missingIds = fixtureIds(missing.state);
  const missingResult = await missing.actions.createBookingFor(missingIds.candidate.id);
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.ok ? "" : missingResult.error, /Teams join URL/i);
  assert.equal(missing.commitCalls, 0);

  const webLink = createHarness({
    state: liveCalendarState("Microsoft Graph"),
    liveCalendarEnabled: true,
    fetchBody: {
      status: "created",
      eventId: "evt-graph-2",
      link: "https://outlook.office.com/calendar/item/abc",
    },
  });
  const webIds = fixtureIds(webLink.state);
  const webResult = await webLink.actions.createBookingFor(webIds.candidate.id);
  assert.equal(webResult.ok, false);
  assert.match(webResult.ok ? "" : webResult.error, /Teams join URL/i);

  const okHarness = createHarness({
    state: liveCalendarState("Microsoft Graph"),
    liveCalendarEnabled: true,
    fetchBody: {
      status: "created",
      eventId: "evt-graph-3",
      link: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ok",
    },
  });
  const okIds = fixtureIds(okHarness.state);
  const okResult = await okHarness.actions.createBookingFor(okIds.candidate.id);
  assert.equal(okResult.ok, true);
  if (!okResult.ok) return;
  assert.equal(
    okResult.booking.teamsLink,
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ok",
  );
});

test("runtime calendar creation retains provider authority when no link is returned", async () => {
  const harness = createHarness({
    state: liveCalendarState(),
    liveCalendarEnabled: true,
    fetchBody: { status: "created", eventId: "evt_without_link", link: null },
  });
  const { candidate } = fixtureIds(harness.state);
  const result = await harness.actions.createBookingFor(candidate.id);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.booking.calendarSync, {
    status: "created",
    seatId: "11111111-1111-4111-8111-111111111111",
    provider: "Gmail API",
    eventId: "evt_without_link",
  });
  assert.match(
    harness.activityDrafts.at(-1)?.notes ?? "",
    /Calendar event confirmed; meeting link unavailable\./,
  );
  const next = futureBookingRange(31);
  const moved = harness.actions.updateBooking(result.booking.id, next);
  assert.equal(moved.ok, false);
  assert.match(moved.ok ? "" : moved.error, /calendar provider synchronization/i);
  const cancelled = harness.actions.updateBooking(result.booking.id, {
    status: "Cancelled",
  });
  assert.equal(cancelled.ok, false);
});

test("runtime calendar response failures never commit or emit a booking", async (t) => {
  const cases: Array<{
    name: string;
    options: Parameters<typeof createHarness>[0];
    error: RegExp;
  }> = [
    {
      name: "skipped",
      options: { fetchBody: { status: "skipped", detail: "Calendar scope missing." } },
      error: /outcome is unknown.*reconciliation.*do not retry/i,
    },
    {
      name: "dry-run",
      options: { fetchBody: { status: "dry-run" } },
      error: /not created/i,
    },
    {
      name: "unknown status",
      options: { fetchBody: { status: "unexpected" } },
      error: /invalid response.*reconciliation.*do not retry/i,
    },
    {
      name: "missing receipt",
      options: {
        fetchBody: { status: "created", link: "https://calendar.example.test/event" },
      },
      error: /no provider receipt.*reconciliation.*do not retry/i,
    },
    {
      name: "invalid link",
      options: {
        fetchBody: {
          status: "created",
          eventId: "evt_invalid_link",
          link: "javascript:alert(1)",
        },
      },
      error: /link was invalid.*reconciliation.*do not retry/i,
    },
    {
      name: "non-2xx",
      options: {
        fetchBody: { status: "error", detail: "Provider unavailable." },
        fetchStatus: 503,
      },
      error: /outcome is unknown.*reconciliation.*do not retry/i,
    },
    {
      name: "network error",
      options: { fetchError: new Error("network unavailable") },
      error: /outcome is unknown.*reconciliation.*do not retry/i,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const harness = createHarness({
        ...item.options,
        state: liveCalendarState(),
        liveCalendarEnabled: true,
      });
      const { candidate } = fixtureIds(harness.state);
      const result = await harness.actions.createBookingFor(candidate.id);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, item.error);
      assert.equal(harness.commitCalls, 0);
      assert.equal(harness.state.bookings.length, 0);
      assert.equal(harness.events.length, 0);
    });
  }
});

test("runtime booking updates validate the patch and synchronize embedded booking state", async () => {
  const created = createHarness();
  const { candidate } = fixtureIds(created.state);
  const result = await created.actions.createBookingFor(candidate.id);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(created.actions.updateBooking("missing", { status: "Completed" }), {
    ok: false,
    error: "Booking not found.",
  });
  assert.equal(created.actions.updateBooking(result.booking.id, { startTime: "" }).ok, false);
  assert.equal(
    created.actions.updateBooking(result.booking.id, { candidateId: "other" } as never).ok,
    false,
  );
  const pastStart = new Date(Date.now() - 86_400_000);
  const past = created.actions.updateBooking(result.booking.id, {
    startTime: pastStart.toISOString(),
    endTime: new Date(pastStart.getTime() + 30 * 60_000).toISOString(),
  });
  assert.equal(past.ok, false);
  const completed = created.actions.updateBooking(result.booking.id, { status: "Completed" });
  assert.equal(completed.ok, true);
  const storedCandidate = created.state.candidates.find((item) => item.id === candidate.id);
  assert.equal(storedCandidate?.booking?.status, "Completed");
  assert.equal(storedCandidate?.stage, "Interviewed");
  assert.equal(created.activityDrafts.at(-1)?.linkedEntityId, result.booking.id);
  assert.match(created.activityDrafts.at(-1)?.title ?? "", /Interview marked Completed/);
  assert.equal(created.recomputeCalls, 2);
  assert.equal(
    created.actions.updateBooking(result.booking.id, { status: "Confirmed" }).ok,
    false,
  );
});

test("runtime booking updates leave state and audit unchanged after commit rejection", async () => {
  const created = createHarness();
  const { candidate } = fixtureIds(created.state);
  const result = await created.actions.createBookingFor(candidate.id);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const rejected = createHarness({ state: created.state, commitAllowed: false });
  const before = structuredClone(rejected.state);
  const update = rejected.actions.updateBooking(result.booking.id, {
    status: "Completed",
  });
  assert.equal(update.ok, false);
  assert.deepEqual(rejected.state, before);
  assert.equal(rejected.activityDrafts.length, 0);
});

test("runtime booking creation permits a new round after terminal interview outcomes", async () => {
  for (const [index, status] of (["Completed", "No Show"] as const).entries()) {
    const harness = createHarness();
    const { candidate } = fixtureIds(harness.state);
    const first = await harness.actions.createBookingFor(candidate.id);
    assert.equal(first.ok, true);
    if (!first.ok) continue;
    assert.equal(harness.actions.updateBooking(first.booking.id, { status }).ok, true);
    const next = futureBookingRange(40 + index);
    const second = await harness.actions.createBookingFor(candidate.id, next);
    assert.equal(second.ok, true, `${status} must allow a later interview round`);
    assert.equal(harness.state.bookings.length, 2);
  }
});

test("runtime booking updates fail closed when a provider-linked invite would drift", async () => {
  const created = createHarness();
  const { candidate } = fixtureIds(created.state);
  const result = await created.actions.createBookingFor(candidate.id);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const providerState: HermesState = {
    ...created.state,
    bookings: created.state.bookings.map((booking) =>
      booking.id === result.booking.id
        ? { ...booking, calLink: "https://calendar.example.test/event" }
        : booking,
    ),
    candidates: created.state.candidates.map((item) =>
      item.booking?.id === result.booking.id
        ? {
            ...item,
            booking: {
              ...item.booking,
              calLink: "https://calendar.example.test/event",
            },
          }
        : item,
    ),
  };
  const harness = createHarness({ state: providerState });
  const next = futureBookingRange(32);
  const moved = harness.actions.updateBooking(result.booking.id, {
    startTime: next.startTime,
    endTime: next.endTime,
  });
  assert.equal(moved.ok, false);
  assert.match(moved.ok ? "" : moved.error, /calendar provider synchronization/i);
  const cancelled = harness.actions.updateBooking(result.booking.id, {
    status: "Cancelled",
  });
  assert.equal(cancelled.ok, false);
  assert.match(cancelled.ok ? "" : cancelled.error, /calendar provider synchronization/i);
  assert.equal(harness.commitCalls, 0);
});

test("runtime report and learning decisions propagate rejection and apply once", () => {
  const rejected = createHarness({ commitAllowed: false });
  const rejectedIds = fixtureIds(rejected.state);
  const rejectedBefore = structuredClone(rejected.state);
  assert.equal(rejected.actions.generateReport(rejectedIds.campaign.id), null);
  assert.deepEqual(rejected.state, rejectedBefore);

  const accepted = createHarness();
  const { campaign } = fixtureIds(accepted.state);
  const report = accepted.actions.generateReport(campaign.id);
  assert.ok(report);
  const proposal = accepted.state.campaigns
    .find((item) => item.id === campaign.id)
    ?.skillUpdates[0];
  assert.ok(proposal);
  const decisionRejected = createHarness({
    state: accepted.state,
    commitAllowed: false,
  });
  const decisionBefore = structuredClone(decisionRejected.state);
  assert.equal(
    decisionRejected.actions.setSkillUpdateStatus(
      campaign.id,
      proposal.id,
      "accepted",
    ),
    false,
  );
  assert.deepEqual(decisionRejected.state, decisionBefore);
  assert.equal(decisionRejected.activityDrafts.length, 0);
  const beforeVersion = accepted.state.skills.find((item) => item.key === proposal.skill)?.version;
  const beforeCommitCalls = accepted.commitCalls;
  assert.equal(
    accepted.actions.setSkillUpdateStatus(campaign.id, proposal.id, "accepted"),
    true,
  );
  assert.equal(accepted.commitCalls, beforeCommitCalls + 1);
  assert.equal(
    accepted.state.campaigns
      .find((item) => item.id === campaign.id)
      ?.skillUpdates.find((item) => item.id === proposal.id)?.status,
    "accepted",
  );
  assert.equal(
    accepted.state.reports
      .find((item) => item.campaignId === campaign.id)
      ?.skillUpdates.find((item) => item.id === proposal.id)?.status,
    "accepted",
  );
  assert.equal(
    accepted.state.skills.find((item) => item.key === proposal.skill)?.version,
    (beforeVersion ?? 0) + 1,
  );
  assert.equal(
    accepted.actions.setSkillUpdateStatus(campaign.id, proposal.id, "accepted"),
    false,
  );

  const regenerated = accepted.actions.generateReport(campaign.id);
  assert.ok(regenerated);
  const canonical = regenerated.skillUpdates.find(
    (item) => item.skill === proposal.skill && item.title === proposal.title,
  );
  assert.equal(canonical?.id, proposal.id);
  assert.equal(canonical?.status, "accepted");
  assert.equal(accepted.activityDrafts.at(-1)?.notes, "0 skill updates proposed.");
});
