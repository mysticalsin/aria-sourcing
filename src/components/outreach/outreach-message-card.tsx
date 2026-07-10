"use client";

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardTitle,
  Badge,
  Button,
  Input,
  Textarea,
  Field,
  Select,
  Eyebrow,
  useToast,
} from "@/components/ui";
import { useActions, useCandidate, useCampaign, useSettings } from "@/lib/store";
import { OUTREACH_TONES, type OutreachMessage, type OutreachTone } from "@/lib/types";
import {
  initialsFrom,
  formatTimeAgo,
  scoreTone,
  toneForOutreachStatus,
  type Tone,
} from "@/lib/utils";
import {
  Check,
  X,
  RefreshCw,
  Save,
  Mail,
  Linkedin,
  Send,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  Repeat,
  ArrowUpRight,
  Copy,
  ExternalLink,
  Clock,
} from "lucide-react";

/** "waiting 3d" style label for how long a draft has sat in the queue — reuses
 *  formatTimeAgo's tested duration math, just drops the trailing "ago" so it
 *  reads naturally as a waiting duration instead of a past event. */
function waitingLabel(createdAt: string): string {
  const ago = formatTimeAgo(createdAt);
  return ago === "just now" ? "waiting <1m" : `waiting ${ago.replace(/ ago$/, "")}`;
}

/** Escalates tone the longer a draft has been waiting on a human — mirrors the
 *  SLA countdown badge on reply cards (see reply-card.tsx). */
function agingTone(createdAt: string): Tone {
  const days = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  if (days >= 3) return "danger";
  if (days >= 1) return "warning";
  return "neutral";
}

export function OutreachMessageCard({
  message,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  message: OutreachMessage;
  /** Show a bulk-select checkbox (only used on the pending-approval list). */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (messageId: string) => void;
}) {
  const candidate = useCandidate(message.candidateId);
  const campaign = useCampaign(message.campaignId);
  const settings = useSettings();
  const a = useActions();
  const { toast } = useToast();

  const [subject, setSubject] = React.useState(message.subject);
  const [body, setBody] = React.useState(message.body);

  // Re-sync local editor whenever the underlying message changes (regenerate / tone swap).
  React.useEffect(() => {
    setSubject(message.subject);
    setBody(message.body);
  }, [message.subject, message.body]);

  const dirty = subject !== message.subject || body !== message.body;
  const ChannelIcon = message.channel === "Email" ? Mail : Linkedin;
  const hasEvidence = message.personalizationEvidence.length > 0;
  const actionable = message.status === "Needs Approval" || message.status === "Draft";
  const pendingManual = message.status === "Pending Manual Send";
  const settled = message.status === "Scheduled" || message.status === "Approved";
  const rejected = message.status === "Rejected";
  // Live-approved email awaiting the deliberate, gated send (the real delivery step).
  const approvedPendingSend = message.status === "Approved";

  const subjectId = `outreach-subject-${message.id}`;
  const bodyId = `outreach-body-${message.id}`;
  const toneId = `outreach-tone-${message.id}`;

  const name = candidate?.name ?? "Unknown candidate";
  const initials = candidate ? candidate.avatarInitials || initialsFrom(candidate.name) : "??";

  const [regenerating, setRegenerating] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);

  async function handleToneChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tone = e.target.value as OutreachTone;
    setRegenerating(true);
    await a.regenerateOutreach(message.id, tone);
    setRegenerating(false);
    toast({
      title: `Rewritten: ${tone}`,
      description: "Personalization re-derived from the candidate profile.",
      variant: "info",
    });
  }

  function handleSave() {
    a.updateOutreach(message.id, { subject, body });
    toast({
      title: "Edits saved",
      description: "Draft updated. Human approval still required before anything ships.",
      variant: "success",
    });
  }

  async function handleApprove() {
    if (approving) return;
    setApproving(true);
    const res = await a.approveOutreach(message.id);
    setApproving(false);
    if (!res.allowed) {
      toast({
        title: "Approval blocked",
        description: res.blockers.join(" "),
        variant: "error",
      });
      return;
    }
    toast({
      title: "Approved: queued for send",
      description: res.warnings.length
        ? res.warnings.join(" ")
        : "Goes live once the agent seat is connected and its sending domain is verified.",
      variant: "success",
    });
  }

  async function handleReject() {
    if (rejecting) return;
    setRejecting(true);
    const result = await a.rejectOutreach(message.id);
    setRejecting(false);
    if (!result.ok) {
      toast({ title: "Could not reject outreach", description: result.error, variant: "error" });
      return;
    }
    toast({
      title: "Outreach rejected",
      description: "Removed from the approval queue.",
      variant: "warning",
    });
  }

  async function handleRegenerate() {
    setRegenerating(true);
    await a.regenerateOutreach(message.id, message.tone);
    setRegenerating(false);
    toast({
      title: "Draft regenerated",
      description: "Fresh copy generated from the candidate signals.",
      variant: "info",
    });
  }

  const [copied, setCopied] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  async function handleCopyMessage() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "Message copied", description: "Paste it into LinkedIn and send.", variant: "success" });
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "warning" });
    }
  }

  function handleOpenLinkedIn() {
    const url = candidate?.linkedinUrl;
    if (!url) {
      toast({ title: "No LinkedIn URL", description: "This candidate has no LinkedIn profile on file.", variant: "error" });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleConfirmManualSend() {
    const res = a.confirmManualSend(message.id);
    if (!res.ok) {
      toast({ title: "Could not confirm", description: res.error, variant: "error" });
      return;
    }
    toast({
      title: "LinkedIn send confirmed",
      description: "Ledger updated. The candidate is marked as contacted.",
      variant: "success",
    });
  }

  async function handleSend() {
    setSending(true);
    const res = await a.sendApprovedOutreach(message.id);
    setSending(false);
    if (!res.ok) {
      toast({ title: "Send blocked", description: res.error, variant: "error" });
      return;
    }
    if (res.queued) {
      toast({
        title: "WhatsApp queued",
        description: "ARIA will re-check consent, do-not-contact status, the reply window, and your approval before delivery.",
        variant: "success",
      });
      return;
    }
    toast({
      title: "Email sent",
      description: "Delivered from the live mailbox. The candidate is now marked as contacted.",
      variant: "success",
    });
  }

  return (
    <Card className="animate-fade-in overflow-hidden">
      <CardContent className="space-y-5">
        {/* Header: candidate summary + score + status */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {selectable && (
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect?.(message.id)}
                aria-label={`Select ${name} for bulk approval`}
                className="h-4 w-4 shrink-0 rounded border-line accent-tangerine focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
              />
            )}
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-sm font-bold text-ink-soft ring-1 ring-inset ring-ink/10"
              aria-hidden
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-tight text-ink">{name}</p>
              {candidate && (
                <p className="truncate text-sm text-muted">
                  {candidate.currentTitle} @ {candidate.currentCompany}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {candidate && (
              <Badge tone={scoreTone(candidate.matchScore)} dot>
                {candidate.matchScore} match
              </Badge>
            )}
            <Badge tone="neutral">
              <ChannelIcon className="h-3 w-3" aria-hidden /> {message.channel}
            </Badge>
            <Badge tone={toneForOutreachStatus(message.status)}>{message.status}</Badge>
            {(actionable || pendingManual) && (
              <Badge tone={agingTone(message.createdAt)} size="sm">
                <Clock className="h-3 w-3" aria-hidden /> {waitingLabel(message.createdAt)}
              </Badge>
            )}
          </div>
        </div>

        {/* Personalization evidence */}
        <div className="space-y-2">
          <Eyebrow className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" aria-hidden /> Personalization evidence
          </Eyebrow>
          {hasEvidence ? (
            <div className="flex flex-wrap gap-1.5">
              {message.personalizationEvidence.map((ev, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-aqua-soft px-2.5 py-1 text-xs font-medium text-aqua ring-1 ring-inset ring-aqua/20"
                >
                  {ev}
                </span>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-2xl bg-warning-soft px-3 py-2.5 text-xs font-medium text-[hsl(32_90%_34%)] ring-1 ring-inset ring-warning/30">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              No personalization attached. Approval will be blocked until evidence is present. Regenerate to fix.
            </div>
          )}
        </div>

        {/* Tone control */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tone" htmlFor={toneId} hint="Switching tone regenerates the copy.">
            <Select
              id={toneId}
              value={message.tone}
              onChange={handleToneChange}
              disabled={settled || regenerating || approving || rejecting}
              options={OUTREACH_TONES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field
            label="Subject line"
            htmlFor={subjectId}
            hint={campaign ? `Campaign · ${campaign.title}` : undefined}
          >
            <Input
              id={subjectId}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={settled || approving || rejecting}
              placeholder="Subject line"
            />
          </Field>
        </div>

        {/* Body editor */}
        <Field label="Message body" htmlFor={bodyId}>
          <Textarea
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={settled || approving || rejecting}
            className="min-h-[160px]"
            placeholder="Message body"
          />
        </Field>

        {/* LinkedIn assisted-manual send panel */}
        {pendingManual && (
          <div className="space-y-3 rounded-2xl bg-tangerine-soft px-3.5 py-3 text-sm text-tangerine ring-1 ring-inset ring-tangerine/20">
            <div className="flex items-start gap-2.5">
              <Linkedin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">LinkedIn message ready: manual send required</p>
                <p className="mt-0.5 text-tangerine/80">
                  Aria cannot send LinkedIn messages automatically. Copy the draft, open the candidate&apos;s profile, paste it, then confirm here.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Copy className="h-4 w-4" />}
                onClick={handleCopyMessage}
              >
                {copied ? "Copied" : "Copy message"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                leftIcon={<ExternalLink className="h-4 w-4" />}
                onClick={handleOpenLinkedIn}
                disabled={!candidate?.linkedinUrl}
              >
                Open LinkedIn
              </Button>
              <Button
                size="sm"
                variant="primary"
                leftIcon={<Check className="h-4 w-4" />}
                onClick={handleConfirmManualSend}
              >
                Confirm manual send
              </Button>
            </div>
          </div>
        )}

        {/* Settled confirmation banner */}
        {settled && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-success-soft px-3.5 py-3 text-sm text-success ring-1 ring-inset ring-success/20">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {message.dryRun
                  ? "Approved / Queued for send"
                  : approvedPendingSend
                    ? "Approved, ready to send"
                    : "Approved / Sent"}
              </p>
              <p className="mt-0.5 text-success/80">
                {message.approvedBy ? `Approved by ${message.approvedBy}` : "Approved"}
                {message.scheduledFor ? ` · ${formatTimeAgo(message.scheduledFor)}` : ""}
                {message.dryRun ? " · Nothing sent live." : ""}
                {approvedPendingSend ? " · Review done. Click Send to deliver." : ""}
              </p>
            </div>
            {approvedPendingSend && (
              <Button size="sm" disabled={sending} onClick={handleSend}>
                <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {sending ? "Sending…" : "Send now"}
              </Button>
            )}
          </div>
        )}

        {/* Follow-up sequence hint */}
        <div className="flex items-center gap-2 text-xs text-muted">
          <Repeat className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Sequence step {message.sequenceStep} · auto follow-up after{" "}
            {settings.rateLimits.followUpGapDays}d of silence
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {!settled && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Save className="h-4 w-4" />}
              onClick={handleSave}
              disabled={!dirty || approving || rejecting}
            >
              Save edits
            </Button>
          )}
          {actionable && (
            <>
              <Button
                size="sm"
                variant="primary"
                leftIcon={<Check className="h-4 w-4" />}
                onClick={handleApprove}
                loading={approving}
                disabled={approving || rejecting}
              >
                {approving ? "Recording approval…" : "Approve"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<X className="h-4 w-4" />}
                onClick={handleReject}
                disabled={approving || rejecting}
              >
                {rejecting ? "Revoking…" : "Reject"}
              </Button>
            </>
          )}
          {(actionable || rejected) && (
            <Button
              size="sm"
              variant="subtle"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={handleRegenerate}
              loading={regenerating}
              disabled={regenerating || approving || rejecting}
            >
              {regenerating ? "Regenerating…" : "Regenerate"}
            </Button>
          )}
          {candidate && (
            <Link
              href={`/candidates?focus=${candidate.id}`}
              className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-electric transition hover:text-electric/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric rounded-full"
            >
              View candidate
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
