import type { Booking, Interviewer } from "../types";

export function defaultSlot(): Date {
  const d = new Date(Date.now() + 2 * 86_400_000);
  d.setHours(14, 0, 0, 0);
  return d;
}

function getInterviewerByName(interviewers: Interviewer[], name?: string) {
  if (!name) return null;
  return interviewers.find((i) => i.name === name) ?? null;
}

const BOOKING_DURATION_MS = 30 * 60_000;

/** True when `interviewerEmail` already has a non-cancelled booking overlapping
 *  [start, end). Cancelled bookings never block a slot. */
export function interviewerIsBusy(
  bookings: Booking[],
  interviewerEmail: string,
  start: Date,
  end: Date,
  excludeBookingId?: string,
): boolean {
  return bookings.some((b) => {
    if (b.id === excludeBookingId || b.interviewerEmail !== interviewerEmail || b.status === "Cancelled") {
      return false;
    }
    const busyStart = new Date(b.startTime).getTime();
    const busyEnd = new Date(b.endTime).getTime();
    return start.getTime() < busyEnd && end.getTime() > busyStart;
  });
}

/** Finds an interviewer + start time with no scheduling conflict. Round-robins
 *  over the ACTIVE interviewer pool passed in by the caller (starting from
 *  `roundRobinIndex`, same heuristic as before) when neither dimension is
 *  pinned by the caller; when the caller pins an interviewer and/or a start
 *  time explicitly, that choice is respected as a hard constraint and only
 *  the unpinned dimension is advanced to find a free slot. Guards against the
 *  "5th booking of the day reuses interviewer #1's exact slot" double-booking
 *  with zero conflict check that existed before.
 *
 *  When `interviewers` is empty (no one registered yet — see the interviewers
 *  store slice), this returns a booking with no interviewer rather than
 *  inventing one: an honest gap, not a fabricated roster. */
export function resolveBookingSlot(
  bookings: Booking[],
  interviewers: Interviewer[],
  roundRobinIndex: number,
  opts?: { startTime?: string; interviewerName?: string },
): { interviewer: Interviewer | null; start: Date } | { error: string } {
  const pinnedStart = opts?.startTime ? new Date(opts.startTime) : null;
  if (
    pinnedStart &&
    (!Number.isFinite(pinnedStart.getTime()) || pinnedStart.getTime() <= Date.now())
  ) {
    return { error: "Interview start time must be a valid future date." };
  }

  const pinnedInterviewer = getInterviewerByName(interviewers, opts?.interviewerName);
  if (opts?.interviewerName && !pinnedInterviewer) {
    return { error: "Selected interviewer is not active or does not exist." };
  }

  if (interviewers.length === 0) {
    return { interviewer: null, start: pinnedStart ?? defaultSlot() };
  }

  const pool = pinnedInterviewer
    ? [pinnedInterviewer]
    : interviewers.map((_, i) => interviewers[(roundRobinIndex + i) % interviewers.length]);

  // A pinned start is a hard constraint regardless of whether an interviewer is
  // also pinned: only the interviewer dimension is searched, the clock never
  // advances. (Matches this function's documented contract — see doc comment.)
  if (pinnedStart) {
    const end = new Date(pinnedStart.getTime() + BOOKING_DURATION_MS);
    const free = pool.find((i) => !interviewerIsBusy(bookings, i.email, pinnedStart, end));
    if (free) return { interviewer: free, start: pinnedStart };
    return {
      error: pinnedInterviewer
        ? `${pinnedInterviewer.name} is already booked at that time.`
        : "No interviewer is free at that time.",
    };
  }

  let start = defaultSlot();
  const maxAttempts = 48; // up to 24h of 30-min slots before giving up
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const end = new Date(start.getTime() + BOOKING_DURATION_MS);
    const free = pool.find((i) => !interviewerIsBusy(bookings, i.email, start, end));
    if (free) return { interviewer: free, start };
    start = new Date(start.getTime() + BOOKING_DURATION_MS);
  }
  return { error: "No open interview slot found for any interviewer in the next 24 hours." };
}
