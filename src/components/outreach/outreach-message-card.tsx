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
} from "@/lib/utils";
import {
  Check,
  X,
  RefreshCw,
  Save,
  Mail,
  Linkedin,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  Repeat,
  ArrowUpRight,
} from "lucide-react";

export function OutreachMessageCard({ message }: { message: OutreachMessage }) {
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
  const settled = message.status === "Scheduled" || message.status === "Approved";
  const rejected = message.status === "Rejected";

  const subjectId = `outreach-subject-${message.id}`;
  const bodyId = `outreach-body-${message.id}`;
  const toneId = `outreach-tone-${message.id}`;

  const name = candidate?.name ?? "Unknown candidate";
  const initials = candidate ? candidate.avatarInitials || initialsFrom(candidate.name) : "??";

  function handleToneChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tone = e.target.value as OutreachTone;
    a.regenerateOutreach(message.id, tone);
    toast({
      title: `Rewritten — ${tone}`,
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

  function handleApprove() {
    const res = a.approveOutreach(message.id);
    if (!res.allowed) {
      toast({
        title: "Approval blocked",
        description: res.blockers.join(" "),
        variant: "error",
      });
      return;
    }
    toast({
      title: settings.dryRunMode ? "Approved — dry-run scheduled" : "Approved — scheduled",
      description: res.warnings.length
        ? res.warnings.join(" ")
        : "Nothing sent live. Human approval, machine speed.",
      variant: "success",
    });
  }

  function handleReject() {
    a.rejectOutreach(message.id);
    toast({
      title: "Outreach rejected",
      description: "Removed from the approval queue.",
      variant: "warning",
    });
  }

  function handleRegenerate() {
    a.regenerateOutreach(message.id, message.tone);
    toast({
      title: "Draft regenerated",
      description: "Fresh copy generated from the candidate signals.",
      variant: "info",
    });
  }

  return (
    <Card className="animate-fade-in overflow-hidden">
      <CardContent className="space-y-5">
        {/* Header: candidate summary + score + status */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
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
              No personalization attached — approval will be blocked until evidence is present. Regenerate to fix.
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
              disabled={settled}
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
              disabled={settled}
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
            disabled={settled}
            className="min-h-[160px]"
            placeholder="Message body"
          />
        </Field>

        {/* Settled confirmation banner */}
        {settled && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-success-soft px-3.5 py-3 text-sm text-success ring-1 ring-inset ring-success/20">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">
                {message.dryRun ? "Approved / Dry-run scheduled" : "Approved / Scheduled"}
              </p>
              <p className="mt-0.5 text-success/80">
                {message.approvedBy ? `Approved by ${message.approvedBy}` : "Approved"}
                {message.scheduledFor ? ` · ${formatTimeAgo(message.scheduledFor)}` : ""}
                {message.dryRun ? " · Nothing sent live." : ""}
              </p>
            </div>
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
              disabled={!dirty}
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
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<X className="h-4 w-4" />}
                onClick={handleReject}
              >
                Reject
              </Button>
            </>
          )}
          {(actionable || rejected) && (
            <Button
              size="sm"
              variant="subtle"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={handleRegenerate}
            >
              Regenerate
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
