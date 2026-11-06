"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Clock, ExternalLink, Linkedin, Loader2, RefreshCw, Send, UserPlus, X } from "lucide-react";
import { Button, Eyebrow, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ApiResult } from "./api";
import { Composer } from "./composer";
import { useNow } from "./format";
import {
  checkCandidate,
  inviteCandidate,
  messageCandidate,
  refreshLinkedIn,
  useCandidateLinkedIn,
  withdraw,
  type CandidateLinkedIn as Contact,
} from "./linkedin-store";
import { ThreadView } from "./thread-view";
import { useBridgeExtension } from "./use-bridge-extension";

const SETTINGS_HREF = "/settings?tab=integrations#linkedin";

/** Client mirror of the server's check (the server refuses anyway). */
export function linkedInContactBlock(flags: {
  doNotContact?: boolean;
  suppressed?: boolean;
  unsubscribed?: boolean;
  anonymized?: boolean;
} | null | undefined): string | null {
  if (!flags) return null;
  if (flags.anonymized) return "This candidate's data was anonymized.";
  if (flags.doNotContact) return "This candidate is marked do-not-contact.";
  if (flags.unsubscribed) return "This candidate unsubscribed.";
  if (flags.suppressed) return "This candidate is on the suppression list.";
  return null;
}

function dateLabel(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
}

function RelationshipChip({ contact, checking }: { contact: Contact | null; checking: boolean }) {
  if (checking || !contact) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-semibold text-ink-soft">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking LinkedIn…
      </span>
    );
  }
  const map: Record<Contact["relationship"], { label: string; tone: string; icon: React.ReactNode }> = {
    connected: { label: "Connected · 1st", tone: "bg-[#0a66c2]/10 text-[#0a66c2]", icon: <Check className="h-3 w-3" aria-hidden /> },
    pending: {
      label: `Invitation pending${contact.invitedAt ? ` · sent ${dateLabel(contact.invitedAt)}` : ""}`,
      tone: "bg-warning-soft text-[hsl(32_90%_34%)]",
      icon: <Clock className="h-3 w-3" aria-hidden />,
    },
    none: { label: "Not connected", tone: "bg-ink/[0.06] text-ink-soft", icon: <UserPlus className="h-3 w-3" aria-hidden /> },
    not_found: { label: "Profile not found", tone: "bg-danger-soft text-danger", icon: <AlertTriangle className="h-3 w-3" aria-hidden /> },
    unknown: { label: "Standing unknown", tone: "bg-ink/[0.06] text-ink-soft", icon: <Linkedin className="h-3 w-3" aria-hidden /> },
  };
  const m = map[contact.relationship];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", m.tone)}>
      {m.icon}
      {m.label}
    </span>
  );
}

function InviteForm({ firstName, limit, onInvite }: { firstName: string; limit: number; onInvite: (note: string) => Promise<boolean> }) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="space-y-2 rounded-xl border border-line bg-ink/[0.02] p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const ok = await onInvite(note);
        setBusy(false);
        if (ok) setNote("");
      }}
    >
      <p className="text-sm text-ink">
        {firstName} is not a connection yet. LinkedIn only delivers messages to connections: invite them first.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, limit))}
        rows={3}
        placeholder={`Add a note (optional), e.g. "Hi ${firstName}, I'm hiring for a role that fits your background. Happy to connect."`}
        className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-electric/40 focus-visible:outline-none"
        aria-label="Invitation note"
      />
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-[0.7rem] tabular-nums", note.length > limit - 30 ? "text-[hsl(32_90%_34%)]" : "text-muted")}>
          {note.length}/{limit}
        </span>
        <Button type="submit" size="sm" variant="gradient" loading={busy} leftIcon={<UserPlus className="h-4 w-4" />}>
          Send invitation
        </Button>
      </div>
    </form>
  );
}

/**
 * The candidate's LinkedIn, as seen from the signed-in user's own account:
 * where they stand, an invitation when they are not connected, and the
 * conversation with them (only theirs) when they are.
 */
export function CandidateLinkedIn({
  candidateId,
  name,
  linkedinUrl,
  contactBlocked,
}: {
  candidateId: string;
  name: string;
  linkedinUrl: string;
  /** Why ARIA must not contact this candidate (compliance flags), if so. */
  contactBlocked: string | null;
}) {
  const { toast } = useToast();
  const { state, contact } = useCandidateLinkedIn(candidateId);
  const paired = state.status === "ready" && Boolean(state.account?.paired);
  const extension = useBridgeExtension(paired);
  const { nudge } = extension;
  const now = useNow(1000);
  const asked = React.useRef<string | null>(null);
  const firstName = name.split(" ")[0] || name;
  const account = state.account?.account ?? null;

  // First look at this candidate: ask LinkedIn once where they stand. Later
  // checks are explicit or daily for pending invitations (each one counts as a
  // profile view on LinkedIn).
  React.useEffect(() => {
    if (!paired || contact || contactBlocked || asked.current === candidateId) return;
    asked.current = candidateId;
    void checkCandidate(candidateId).then((res) => {
      if (res.ok) nudge();
    });
  }, [paired, contact, contactBlocked, candidateId, nudge]);

  if (state.status === "disabled") return null;

  async function act(run: () => Promise<ApiResult<unknown>>, success: string): Promise<boolean> {
    const res = await run();
    if (!res.ok) {
      toast({ title: "LinkedIn", description: res.error ?? "Failed.", variant: "error" });
      return false;
    }
    nudge();
    toast({ title: success, variant: "success" });
    return true;
  }

  const checking = !contact || contact.checking;
  const waitMs = state.nextWriteAt ? Date.parse(state.nextWriteAt) - now : 0;
  const waitLabel =
    waitMs > 1000 ? `in ${waitMs >= 60_000 ? `${Math.floor(waitMs / 60_000)} min ` : ""}${Math.ceil((waitMs % 60_000) / 1000)} s` : null;
  const pending = contact?.pending ?? null;
  const pendingBusy = pending && (pending.status === "queued" || pending.status === "resolving" || pending.status === "sending");

  let body: React.ReactNode;
  if (state.status === "idle" || state.status === "loading") {
    body = <div className="h-14 animate-pulse rounded-xl bg-ink/[0.04]" aria-busy="true" />;
  } else if (state.status === "unavailable") {
    body = <p className="text-sm text-muted">LinkedIn is unavailable: {state.detail}</p>;
  } else if (!paired) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line p-3">
        <p className="text-sm text-muted">Connect your LinkedIn to invite {firstName} and talk to them from here.</p>
        <Link href={SETTINGS_HREF} className="inline-flex items-center gap-1.5 rounded-full bg-[#0a66c2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#004182]">
          <Linkedin className="h-3.5 w-3.5" aria-hidden /> Connect LinkedIn
        </Link>
      </div>
    );
  } else {
    let main: React.ReactNode = null;
    if (contactBlocked) {
      main = (
        <p className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {contactBlocked} ARIA will not invite or message them.
        </p>
      );
    } else if (contact?.conversation) {
      main = (
        <div className="h-[440px] overflow-hidden rounded-xl border border-line bg-surface">
          <ThreadView
            key={contact.conversation.id}
            conversationId={contact.conversation.id}
            title={name}
            compact
            tick={state.threadTick}
            extensionOnline={Boolean(account?.online)}
            syncing={Boolean(extension.status?.running)}
            nudge={nudge}
            onChanged={refreshLinkedIn}
          />
        </div>
      );
    } else if (contact && !checking) {
      if (contact.relationship === "connected" || contact.relationship === "unknown") {
        main = (
          <div className="overflow-hidden rounded-xl border border-line">
            <p className="px-3 pt-3 text-sm text-muted">
              {contact.relationship === "connected"
                ? `No conversation with ${firstName} yet. Your first message opens one on LinkedIn.`
                : `ARIA could not tell whether ${firstName} is a connection. If not, LinkedIn refuses the message and ARIA offers an invitation.`}
            </p>
            <Composer
              placeholder={`Message ${firstName}…`}
              disabled={Boolean(pendingBusy)}
              onSend={(text) => act(() => messageCandidate(candidateId, text), "Message queued: it leaves within seconds.")}
              hint={account?.online ? "Leaves from your LinkedIn account within seconds." : "The extension is offline: it leaves when Chrome is back."}
            />
          </div>
        );
      } else if (contact.relationship === "none") {
        main = pendingBusy ? null : (
          <InviteForm
            firstName={firstName}
            limit={state.inviteNoteLimit}
            onInvite={(note) => act(() => inviteCandidate(candidateId, note), "Invitation queued: it leaves within seconds.")}
          />
        );
      } else if (contact.relationship === "pending") {
        main = (
          <p className="rounded-xl border border-line bg-ink/[0.02] px-3 py-2.5 text-sm text-muted">
            Waiting for {firstName} to accept. Messages reach them once they do; ARIA checks once a day, or{" "}
            <button type="button" className="font-semibold text-[#0a66c2] underline-offset-2 hover:underline" onClick={() => void checkCandidate(candidateId).then(() => nudge())}>
              check now
            </button>
            .
          </p>
        );
      } else {
        main = (
          <p className="rounded-xl border border-line px-3 py-2.5 text-sm text-muted">
            LinkedIn does not know this profile. Check the candidate&apos;s LinkedIn URL ({linkedinUrl}).
          </p>
        );
      }
    }

    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <RelationshipChip contact={contact} checking={checking} />
          {contact?.relationship === "connected" && contact.acceptedAt && (
            <span className="text-xs text-muted">accepted {dateLabel(contact.acceptedAt)}</span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              title="Check LinkedIn again"
              aria-label="Check LinkedIn again"
              disabled={checking}
              onClick={() => void checkCandidate(candidateId).then(() => nudge())}
              className="rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
            </button>
            <a
              href={linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-[#0a66c2] hover:bg-[#0a66c2]/10"
            >
              Profile <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </span>
        </div>
        {account?.extensionOutdated && (
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Your ARIA extension ({account.extensionVersion}) is out of date: reload it in chrome://extensions to invite and check candidates.
          </p>
        )}
        {contact?.lookupError && !checking && <p className="text-xs text-danger">{contact.lookupError}</p>}
        {pending && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-xs animate-fade-in",
              pending.status === "failed" ? "bg-danger-soft text-danger" : pending.status === "unknown" ? "bg-warning-soft text-ink" : "bg-[#0a66c2]/[0.07] text-[#0a66c2]",
            )}
          >
            {pendingBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : pending.kind === "invitation" ? <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Send className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1">
              {pending.kind === "invitation"
                ? pendingBusy
                  ? pending.status === "resolving"
                    ? "Finding the profile…"
                    : pending.status === "sending"
                      ? "Sending the invitation…"
                      : waitLabel
                        ? `Invitation queued: leaves ${waitLabel} (LinkedIn pacing)`
                        : "Invitation queued…"
                  : pending.status === "unknown"
                    ? "Invitation unconfirmed: ARIA re-checks the profile."
                    : `Invitation not sent: ${pending.error ?? "LinkedIn refused it."}`
                : pendingBusy
                  ? pending.status === "queued" && waitLabel
                    ? `Message queued: leaves ${waitLabel} (LinkedIn pacing)`
                    : "Message on its way…"
                  : `Message not sent: ${pending.error ?? "LinkedIn refused it."}`}
            </span>
            {(pending.status === "queued" || pending.status === "failed" || pending.status === "unknown") && (
              <button type="button" aria-label="Dismiss" className="rounded p-0.5 hover:bg-black/5" onClick={() => void withdraw(pending.id)}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {main}
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-label="LinkedIn">
      <div className="flex items-center gap-2">
        <span className="text-ink/50">
          <Linkedin className="h-4 w-4" aria-hidden />
        </span>
        <Eyebrow>LinkedIn</Eyebrow>
        {paired && account?.displayName && <span className="truncate text-[0.7rem] text-muted">· from your account ({account.displayName})</span>}
      </div>
      {body}
    </section>
  );
}
