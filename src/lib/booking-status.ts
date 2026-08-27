import type { Booking } from "./types";

type BookingCalendarState = Pick<
  Booking,
  "calendarSync" | "calLink" | "teamsLink"
>;

/** True when no provider calendar event / Teams join URL is confirmed. */
export function bookingNeedsCalendar(booking: BookingCalendarState): boolean {
  return !booking.calendarSync && !booking.calLink && !booking.teamsLink;
}

export function bookingCalendarSummary(booking: BookingCalendarState): string {
  const hasLink = Boolean(booking.calLink || booking.teamsLink);
  if (booking.calendarSync) {
    return hasLink
      ? "Calendar event and link confirmed by the connected provider."
      : "Calendar event confirmed; meeting link unavailable.";
  }
  return hasLink
    ? "Calendar link recorded — provider sync still required."
    : "Needs calendar — connect Microsoft Graph and book with confirmLive for a Teams meeting.";
}
