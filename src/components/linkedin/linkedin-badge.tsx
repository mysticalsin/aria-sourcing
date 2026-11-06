"use client";

import * as React from "react";
import { AlertTriangle, Clock, Linkedin, Loader2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCandidateLinkedIn } from "./linkedin-store";

/**
 * A candidate's LinkedIn standing with the signed-in user, for list rows.
 * Says nothing when there is nothing to say (bridge off, not connected, never
 * looked up), so the list stays quiet.
 */
export function LinkedInBadge({
  candidateId,
  compact,
  className,
}: {
  candidateId: string;
  /** Icon only (narrow cells such as the Pipeline): the label moves to the tooltip. */
  compact?: boolean;
  className?: string;
}) {
  const { state, contact } = useCandidateLinkedIn(candidateId);
  if (state.status !== "ready" || !state.account?.paired || !contact) return null;

  let tone = "bg-[#0a66c2]/10 text-[#0a66c2]";
  let icon: React.ReactNode = <Linkedin className="h-3 w-3" aria-hidden />;
  let label: string;
  let title: string;
  if (contact.conversation?.unread) {
    tone = "bg-[#0a66c2] text-white";
    icon = <MessageCircle className="h-3 w-3" aria-hidden />;
    label = "Reply";
    title = `Unread LinkedIn reply: ${contact.conversation.preview ?? ""}`;
  } else if (contact.pending && (contact.pending.status === "queued" || contact.pending.status === "resolving" || contact.pending.status === "sending")) {
    icon = <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
    label = contact.pending.kind === "invitation" ? "Inviting" : "Sending";
    title = contact.pending.kind === "invitation" ? "LinkedIn invitation on its way" : "LinkedIn message on its way";
  } else if (contact.pending && contact.pending.status === "failed") {
    tone = "bg-danger-soft text-danger";
    icon = <AlertTriangle className="h-3 w-3" aria-hidden />;
    label = "Not sent";
    title = contact.pending.error ?? "LinkedIn refused it";
  } else if (contact.relationship === "pending") {
    tone = "bg-warning-soft text-[hsl(32_90%_34%)]";
    icon = <Clock className="h-3 w-3" aria-hidden />;
    label = "Invited";
    title = "LinkedIn invitation pending";
  } else if (contact.relationship === "connected") {
    label = contact.conversation ? "In touch" : "1st";
    title = contact.conversation
      ? `LinkedIn conversation: ${contact.conversation.lastDirection === "outbound" ? "you wrote last" : "they wrote last"}`
      : "1st-degree LinkedIn connection";
  } else {
    return null;
  }
  if (compact) {
    return (
      <span
        title={`${label} · ${title}`}
        aria-label={`LinkedIn: ${label}`}
        data-linkedin-badge="compact"
        className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full", tone, className)}
      >
        {icon}
      </span>
    );
  }
  return (
    <span
      title={title}
      data-linkedin-badge="full"
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold", tone, className)}
    >
      {icon}
      {label}
    </span>
  );
}
