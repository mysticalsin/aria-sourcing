// Real interview calendar events on the connected mailbox (Google Calendar /
// Microsoft Graph), using the SAME OAuth connection as sending. The connection must
// carry the calendar scope (calendar.events / Calendars.ReadWrite); a mail-only
// connection returns an insufficient-scope error and the caller falls back to a
// synthetic link. Scope is limited to creating the single interview event.

import type { EmailConnection } from "./types";
import { getAccessTokenForReading } from "./email-oauth";
import { classifyFailedHttpDeliveryState } from "./delivery-outcome";

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
  /** Whether the provider definitely accepted, definitely rejected, or may
   *  have accepted the request. Same contract as OAuthSendOutcome — a caller
   *  must only ever treat "not-sent" as safe to retry / free a claimed slot. */
  deliveryState: "accepted" | "not-sent" | "unknown";
}

function attendeeEmails(ev: CalendarEventInput): string[] {
  const out: string[] = [];
  if (ev.candidateEmail) out.push(ev.candidateEmail);
  if (ev.interviewerEmail) out.push(ev.interviewerEmail);
  return out;
}

/** Accept only real Teams join URLs — never Outlook calendar webLink. */
export function isTeamsMeetingJoinUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "teams.microsoft.com"
      || host.endsWith(".teams.microsoft.com")
      || host === "teams.live.com"
      || host.endsWith(".teams.live.com")
    );
  } catch {
    return false;
  }
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
  // A missing/unrefreshable token is proven pre-transport: no request ever
  // reached Google, so this is always safe to retry.
  if (!token) return { ok: false, provider: "Gmail API", deliveryState: "not-sent", detail: "No access token." };

  const body = {
    summary: `Interview: ${ev.candidateName}, ${ev.role}`,
    description: agendaText(ev),
    start: { dateTime: ev.startTime, timeZone: ev.timezone || "UTC" },
    end: { dateTime: ev.endTime, timeZone: ev.timezone || "UTC" },
    attendees: attendeeEmails(ev).map((email) => ({ email })),
  };
  try {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        provider: "Gmail API",
        deliveryState: classifyFailedHttpDeliveryState(res.status),
        detail: `Google Calendar ${res.status}`,
      };
    }
    const event = (await res.json().catch(() => ({}))) as { id?: string; htmlLink?: string };
    return {
      ok: true,
      provider: "Gmail API",
      eventId: event.id,
      link: event.htmlLink,
      deliveryState: "accepted",
      detail: "Event created.",
    };
  } catch {
    // A timeout or disconnect after the request left this process may have
    // been accepted by Google. Never report it as a definitive failure.
    return { ok: false, provider: "Gmail API", deliveryState: "unknown", detail: "Google Calendar transport failure: delivery state unknown." };
  }
}

/** Create the event on the connection owner's Microsoft 365 calendar. */
export async function createGraphCalendarEvent(
  ev: CalendarEventInput,
  connection: EmailConnection,
): Promise<CalendarEventOutcome> {
  const token = await getAccessTokenForReading(connection);
  // A missing/unrefreshable token is proven pre-transport: no request ever
  // reached Graph, so this is always safe to retry.
  if (!token) return { ok: false, provider: "Microsoft Graph", deliveryState: "not-sent", detail: "No access token." };

  const body = {
    subject: `Interview: ${ev.candidateName}, ${ev.role}`,
    body: { contentType: "text", content: agendaText(ev) },
    start: { dateTime: ev.startTime, timeZone: ev.timezone || "UTC" },
    end: { dateTime: ev.endTime, timeZone: ev.timezone || "UTC" },
    attendees: attendeeEmails(ev).map((address) => ({
      emailAddress: { address },
      type: "required",
    })),
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
  };
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        provider: "Microsoft Graph",
        deliveryState: classifyFailedHttpDeliveryState(res.status),
        detail: `Graph calendar ${res.status}`,
      };
    }
    const event = (await res.json().catch(() => ({}))) as {
      id?: string;
      webLink?: string;
      onlineMeeting?: { joinUrl?: string };
    };
    let joinUrl = event.onlineMeeting?.joinUrl ?? null;
    // Graph sometimes omits onlineMeeting on create; re-fetch once for Teams joinUrl.
    if (!joinUrl && event.id) {
      try {
        const fetched = await fetch(
          `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(event.id)}?$select=id,webLink,onlineMeeting`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (fetched.ok) {
          const full = (await fetched.json().catch(() => ({}))) as {
            onlineMeeting?: { joinUrl?: string };
          };
          joinUrl = full.onlineMeeting?.joinUrl ?? null;
        }
      } catch {
        // Fall through to missing-joinUrl handling below.
      }
    }
    // Never promote Outlook webLink as a Teams meeting URL.
    if (!joinUrl || !isTeamsMeetingJoinUrl(joinUrl)) {
      return {
        ok: false,
        provider: "Microsoft Graph",
        eventId: event.id,
        deliveryState: "unknown",
        detail: "Teams join URL missing after Graph create; reconcile manually before retry.",
      };
    }
    return {
      ok: true,
      provider: "Microsoft Graph",
      eventId: event.id,
      link: joinUrl,
      deliveryState: "accepted",
      detail: "Event created.",
    };
  } catch {
    // A timeout or disconnect after the request left this process may have
    // been accepted by Graph. Never report it as a definitive failure.
    return { ok: false, provider: "Microsoft Graph", deliveryState: "unknown", detail: "Graph calendar transport failure: delivery state unknown." };
  }
}
