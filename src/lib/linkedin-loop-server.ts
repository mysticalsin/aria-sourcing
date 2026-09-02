import "server-only";

// Server wiring for the LinkedIn reply loop: binds the injectable ingest and
// dispatch modules to the service-role client, calendar authority and the
// mailbox connection that owns the calendar. Routes import this; tests never do.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailConnection } from "@/lib/types";
import { createGoogleCalendarEvent, createGraphCalendarEvent } from "@/lib/calendar";
import { claimCalendarBooking, reconcileCalendarBooking } from "@/lib/calendar-authority";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseLinkedInLoopStore } from "@/lib/linkedin-loop-store";
import { ingestLinkedInInbound, type LinkedInIngestResult } from "@/lib/linkedin-inbound";
import { dispatchLinkedInLoopDue, type LoopDispatchStats } from "@/lib/linkedin-loop-dispatch";
import type { LoopBookingDeps } from "@/lib/linkedin-booking";
import type { LoopInboundEvent } from "@/lib/linkedin-loop";
import { composeReplyWithServerProvider } from "@/lib/reply-compose";

export function linkedInLoopBookingDeps(svc: SupabaseClient): LoopBookingDeps {
  return {
    claim: (input) => claimCalendarBooking(svc, input),
    reconcile: (input) => reconcileCalendarBooking(svc, input),
    async resolveCalendar(workspaceId, seatId) {
      const { data: seat } = await svc
        .from("agent_seats")
        .select("id, provider, status, mode")
        .eq("id", seatId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!seat || seat.mode !== "live" || seat.status !== "active") return null;
      if (seat.provider !== "Gmail API" && seat.provider !== "Microsoft Graph") return null;
      const { data: conn } = await svc
        .from("email_connections")
        .select("id, access_token, refresh_token, expires_at, scope, account_email, workspace_id")
        .eq("seat_id", seatId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!conn) return null;
      const provider: "Gmail API" | "Microsoft Graph" = seat.provider === "Gmail API" ? "Gmail API" : "Microsoft Graph";
      const connection: EmailConnection = {
        id: conn.id,
        seatId,
        provider,
        accountEmail: conn.account_email,
        accessToken: decryptSecret(conn.access_token),
        refreshToken: conn.refresh_token ? decryptSecret(conn.refresh_token) : conn.refresh_token,
        expiresAt: conn.expires_at,
        scope: conn.scope,
        connectedAt: "",
        updatedAt: "",
      };
      return {
        provider,
        interviewerEmail: conn.account_email,
        createEvent: (ev) =>
          provider === "Gmail API" ? createGoogleCalendarEvent(ev, connection) : createGraphCalendarEvent(ev, connection),
      };
    },
  };
}

export async function ingestLinkedInLoopEvent(svc: SupabaseClient, event: LoopInboundEvent): Promise<LinkedInIngestResult> {
  return ingestLinkedInInbound(
    {
      store: supabaseLinkedInLoopStore(svc),
      compose: composeReplyWithServerProvider,
      booking: linkedInLoopBookingDeps(svc),
    },
    event,
  );
}

export async function drainLinkedInLoop(svc: SupabaseClient, limit: number): Promise<LoopDispatchStats> {
  return dispatchLinkedInLoopDue({ store: supabaseLinkedInLoopStore(svc) }, limit);
}
