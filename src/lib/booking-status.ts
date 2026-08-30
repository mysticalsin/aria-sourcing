import type { Booking } from "./types";

type BookingCalendarState = Pick<
  Booking,
  "calendarSync" | "calLink" | "teamsLink"
>;

/**
 * True until a real meeting/calendar URL exists.
 * Provider sync alone (eventId without join/calendar link) is incomplete —
 * never claim “Interview booked” without teamsLink or calLink.
 */
export function bookingNeedsCalendar(booking: BookingCalendarState): boolean {
  return !booking.calLink && !booking.teamsLink;
}

export function bookingCalendarSummary(booking: BookingCalendarState): string {
  const hasLink = Boolean(booking.calLink || booking.teamsLink);
  if (hasLink && booking.calendarSync) {
    return "Calendar event and link confirmed by the connected provider.";
  }
  if (hasLink) {
    return "Calendar link recorded — provider sync still required.";
  }
  if (booking.calendarSync) {
    return "Calendar event confirmed; meeting link unavailable — re-book with confirmLive after OnlineMeetings scope.";
  }
  return "Needs calendar — connect Microsoft Graph and book with confirmLive for a Teams meeting when Outlook is live. Cal.com is roadmap-only (not wired); no fake calendar book.";
}

/** Activity / toast title — never claim a live booked interview without calendar proof. */
export function bookingInterviewTitle(
  booking: BookingCalendarState,
  candidateName: string,
): string {
  return bookingNeedsCalendar(booking)
    ? `Needs calendar: ${candidateName}`
    : `Interview booked: ${candidateName}`;
}
