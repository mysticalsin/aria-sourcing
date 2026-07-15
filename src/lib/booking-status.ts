import type { Booking } from "./types";

type BookingCalendarState = Pick<
  Booking,
  "calendarSync" | "calLink" | "teamsLink"
>;

export function bookingCalendarSummary(booking: BookingCalendarState): string {
  const hasLink = Boolean(booking.calLink || booking.teamsLink);
  if (booking.calendarSync) {
    return hasLink
      ? "Calendar event and link confirmed by the connected provider."
      : "Calendar event confirmed; meeting link unavailable.";
  }
  return hasLink
    ? "Calendar link recorded."
    : "Meeting link pending calendar provider confirmation.";
}
