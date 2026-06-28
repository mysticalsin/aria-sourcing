// Real interview calendar events on the connected mailbox (Google Calendar /
// Microsoft Graph), using the SAME OAuth connection as sending. The connection must
// carry the calendar scope (calendar.events / Calendars.ReadWrite); a mail-only
// connection returns an insufficient-scope error and the caller falls back to a
// synthetic link. Scope is limited to creating the single interview event.

import type { EmailConnection } from "./types";
import { getAccessTokenForReading } from "./email-oauth";

export interface CalendarEventInput {
  candidateName: string;
  role: string;
  startTime: string;
  endTime: string;
  timezone: string;
  candidateEmail: string;
  interviewerEmail: string;
  agenda: string[];
}

export interface CalendarEventOutcome {
  ok: boolean;
  provider: string;
  link?: string;
  eventId?: string;
  detail: string;
}

function attendeeEmails(ev: CalendarEventInput): string[] {
  const out: string[] = [];
  if (ev.candidateEmail) out.push(ev.candidateEmail);
  if (ev.interviewerEmail) out.push(ev.interviewerEmail);
  return out;
}

function agendaText(ev: CalendarEventInput): string {
  return ev.agenda.length ? `Agenda:\n- ${ev.agenda.join("\n- ")}` : "Interview";
}

/** Create the event on the connection owner's primary Google Calendar. */
export async function createGoogleCalendarEvent(
  ev: CalendarEventInput,
  connection: EmailConnection,
): Promise<CalendarEventOutcome> {
  const token = await getAccessTokenForReading(connection);
  if (!token) return { ok: false, provider: "Gmail API", detail: "No access token." };

  const body = {
    summary: `Interview: ${ev.candidateName} — ${ev.role}`,
    description: agendaText(ev),
    start: { dateTime: ev.startTime, timeZone: ev.timezone || "UTC" },
    end: { dateTime: ev.endTime, timeZone: ev.timezone || "UTC" },
    attendees: attendeeEmails(ev).map((email) => ({ email })),
  };
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) return { ok: false, provider: "Gmail API", detail: `Google Calendar ${res.status}` };
  const event = (await res.json().catch(() => ({}))) as { id?: string; htmlLink?: string };
  return { ok: true, provider: "Gmail API", eventId: event.id, link: event.htmlLink, detail: "Event created." };
}

/** Create the event on the connection owner's Microsoft 365 calendar. */
export async function createGraphCalendarEvent(
  ev: CalendarEventInput,
  connection: EmailConnection,
): Promise<CalendarEventOutcome> {
  const token = await getAccessTokenForReading(connection);
  if (!token) return { ok: false, provider: "Microsoft Graph", detail: "No access token." };

  const body = {
    subject: `Interview: ${ev.candidateName} — ${ev.role}`,
    body: { contentType: "text", content: agendaText(ev) },
    start: { dateTime: ev.startTime, timeZone: ev.timezone || "UTC" },
    end: { dateTime: ev.endTime, timeZone: ev.timezone || "UTC" },
    attendees: attendeeEmails(ev).map((address) => ({
      emailAddress: { address },
      type: "required",
    })),
  };
  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { ok: false, provider: "Microsoft Graph", detail: `Graph calendar ${res.status}` };
  const event = (await res.json().catch(() => ({}))) as { id?: string; webLink?: string };
  return { ok: true, provider: "Microsoft Graph", eventId: event.id, link: event.webLink, detail: "Event created." };
}
