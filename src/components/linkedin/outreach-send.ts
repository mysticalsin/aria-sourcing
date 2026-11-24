"use client";

import * as React from "react";
import { useToast } from "@/components/ui";
import { useActions } from "@/lib/store";
import { inviteCandidate, messageCandidate } from "./linkedin-store";

/** LinkedIn's limit on an invitation note (mirrors INVITATION_NOTE_LIMIT). */
const NOTE_LIMIT = 300;

export type ApprovedLinkedInSend =
  | { ok: true; kind: "message" | "invitation" }
  | { ok: false; error: string };

/**
 * Deliver an approved LinkedIn outreach message from the user's own LinkedIn.
 * Called only from an approval click: approving the exact text is the
 * person's decision to send it (owner, 2026-11-09). A connection gets the
 * message; someone not connected gets an invitation carrying it as the note
 * when it fits. Anything else stays for a manual send, with the reason.
 * LinkedIn pacing and daily caps still apply on the server.
 */
export async function sendApprovedOutreachOnLinkedIn(candidateId: string, text: string): Promise<ApprovedLinkedInSend> {
  const body = text.trim();
  if (!body) return { ok: false, error: "The message is empty." };
  const message = await messageCandidate(candidateId, body);
  if (message.ok) return { ok: true, kind: "message" };
  if (message.disabled) return { ok: false, error: "The LinkedIn bridge is off." };
  if (/1st-degree/i.test(message.error)) {
    if (body.length > NOTE_LIMIT) {
      return {
        ok: false,
        error: `Not connected yet, and the message is longer than an invitation note (${NOTE_LIMIT}). Invite them from their LinkedIn tab, then send it once they accept.`,
      };
    }
    const invitation = await inviteCandidate(candidateId, body);
    return invitation.ok ? { ok: true, kind: "invitation" } : { ok: false, error: invitation.error };
  }
  return { ok: false, error: message.error };
}

/**
 * After an approval click: send the approved LinkedIn message and, once it is
 * queued, record the outreach as sent (candidate Contacted, history, ledger).
 * On failure it stays in Pending manual send ("Send with my LinkedIn" or
 * copy-paste), with the reason.
 */
export function useDeliverApprovedLinkedIn() {
  const actions = useActions();
  const { toast } = useToast();
  return React.useCallback(
    async (message: { id: string; candidateId: string; body: string }, options: { quiet?: boolean } = {}): Promise<ApprovedLinkedInSend> => {
      const res = await sendApprovedOutreachOnLinkedIn(message.candidateId, message.body);
      if (!res.ok) {
        if (!options.quiet) {
          toast({ title: "Approved, not sent on LinkedIn", description: `${res.error} It waits in Pending manual send.`, variant: "warning" });
        }
        return res;
      }
      actions.confirmManualSend(message.id, "bridge");
      if (!options.quiet) {
        toast({
          title: res.kind === "invitation" ? "Invitation sent with your message" : "Sent from your LinkedIn",
          description: "It leaves within seconds (LinkedIn pacing applies).",
          variant: "success",
        });
      }
      return res;
    },
    [actions, toast],
  );
}
