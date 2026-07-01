"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Drawer,
  Eyebrow,
  useToast,
  useConfirm,
} from "@/components/ui";
import { ScoreGauge } from "@/components/charts/score-gauge";
import { ScoreBreakdown } from "@/components/candidates/score-breakdown";
import { useActions, useCampaign, useCandidate, useSettings } from "@/lib/store";
import {
  downloadText,
  formatTimeAgo,
  toneForIntent,
  toneForOutreachStatus,
} from "@/lib/utils";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import type { Candidate } from "@/lib/types";
import {
  Ban,
  Briefcase,
  Building2,
  CalendarPlus,
  Clock,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Linkedin,
  Lock,
  Mail,
  Phone,
  MapPin,
  MessageSquare,
  Send,
  ShieldAlert,
  Sparkles,
  UserX,
} from "lucide-react";

function Section({
  title,
  children,
  icon,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon && <span className="text-ink/50">{icon}</span>}
        <Eyebrow>{title}</Eyebrow>
      </div>
      {children}
    </section>
  );
}

function Chips({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">None recorded.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {items.map((item) => (
        <li key={item}>
          <span className="inline-flex rounded-full bg-ink/[0.05] px-2.5 py-1 text-xs font-medium text-ink-soft">
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CandidateDrawer({
  candidate,
  open,
  onClose,
}: {
  candidate: Candidate | null;
  open: boolean;
  onClose: () => void;
}) {
  const actions = useActions();
  const { toast } = useToast();
  const confirm = useConfirm();
  // Always read the LIVE record so in-drawer mutations (stage, compliance, history)
  // reflect immediately instead of showing the click-time snapshot.
  const liveCandidate = useCandidate(candidate?.id);
  const campaign = useCampaign(candidate?.campaignId);
  const confidentialityMode = Boolean(useSettings().confidentialityMode);
  const [revealed, setRevealed] = useState(false);

  const candidateId = candidate?.id ?? null;
  useEffect(() => {
    setRevealed(false);
  }, [candidateId, open]);

  if (!candidate) {
    return (
      <Drawer open={false} onClose={onClose} title="Candidate">
        <div />
      </Drawer>
    );
  }

  const c = liveCandidate ?? candidate;
  const purpose = hasOutreachPurpose(c.stage);
  const masked = confidentialityMode && !purpose && !revealed;
  const dc = applyConfidentiality(c, {
    confidentialityMode,
    reveal: purpose || revealed,
  });
  const flags = c.complianceFlags;
  const hasFlags =
    flags.doNotContact ||
    flags.suppressed ||
    flags.unsubscribed ||
    flags.anonymized ||
    flags.gdprExportRequested;

  const handleGenerate = () => {
    const msg = actions.generateOutreachFor(c.id);
    if (msg) {
      toast({
        title: "Outreach drafted",
        description: `${c.name}: review in the outreach queue.`,
        variant: "success",
      });
    } else {
      toast({ title: "Could not generate outreach", variant: "error" });
    }
  };

  const handleBook = async () => {
    const res = await actions.createBookingFor(c.id);
    if (res) {
      toast({
        title: "Interview booked (dry-run)",
        description: `With ${res.booking.interviewer}. Teams + Cal.com links generated.`,
        variant: "success",
      });
    } else {
      toast({ title: "Could not book interview", variant: "error" });
    }
  };

  const handleExport = () => {
    const json = actions.exportCandidate(c.id);
    downloadText(`candidate-${c.id}.json`, json, "application/json");
    toast({
      title: "Data exported",
      description: "GDPR data package downloaded as JSON.",
      variant: "success",
    });
  };

  const handleAnonymize = async () => {
    if (!(await confirm({ title: `Anonymize ${c.name}?`, description: "This redacts their PII and cannot be undone.", confirmLabel: "Anonymize", danger: true }))) return;
    actions.anonymizeCandidate(c.id);
    toast({ title: "Candidate anonymized", description: "PII has been redacted.", variant: "success" });
  };

  const handleSuppress = async () => {
    if (!(await confirm({ title: `Suppress contact with ${c.name}?`, description: "They will be excluded from outreach.", confirmLabel: "Suppress", danger: true }))) return;
    actions.suppressCandidate(c.id);
    toast({ title: "Contact suppressed", description: `${c.name} moved out of active outreach.`, variant: "warning" });
  };

  const handleDoNotContact = async () => {
    if (!(await confirm({ title: `Mark ${c.name} as do-not-contact?`, description: "This is a hard exclusion.", confirmLabel: "Mark do-not-contact", danger: true }))) return;
    actions.markDoNotContact(c.id);
    toast({ title: "Marked do-not-contact", description: `${c.name} added to the exclusion list.`, variant: "warning" });
  };

  const handleReveal = () => {
    if (revealed) return;
    setRevealed(true);
    actions.recordPiiReveal(c.id);
    toast({
      title: "Access logged",
      description: "Contact details revealed; this reveal was written to the audit trail.",
      variant: "info",
    });
  };

  const contactBlocked = flags.doNotContact || flags.suppressed || flags.unsubscribed;

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="md"
        leftIcon={<Send className="h-4 w-4" />}
        onClick={handleGenerate}
        disabled={contactBlocked}
        title={contactBlocked ? "Candidate is suppressed / do-not-contact" : undefined}
      >
        Generate outreach
      </Button>
      <Button
        variant="primary"
        size="md"
        leftIcon={<CalendarPlus className="h-4 w-4" />}
        onClick={handleBook}
        disabled={contactBlocked}
        title={contactBlocked ? "Candidate is suppressed / do-not-contact" : undefined}
      >
        Book interview
      </Button>
      <Link
        href="/outreach"
        className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-electric hover:bg-electric-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
      >
        Review outreach queue
      </Link>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={dc.name}
      description={masked ? "Confidential candidate · PII minimized" : `${c.currentTitle} @ ${c.currentCompany}`}
      footer={footer}
      width="max-w-2xl"
    >
      <div className="space-y-8 animate-fade-in">
        {/* Header meta */}
        <div className="space-y-3">
          {campaign && (
            <Badge tone="electric" size="sm">
              {campaign.title}
            </Badge>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden />
              {c.location}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" aria-hidden />
              {c.timezone}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" aria-hidden />
              {c.sourcePlatform}
            </span>
          </div>
          <p className="rounded-2xl bg-ink/[0.03] px-3 py-2 font-mono text-xs text-ink-soft break-words">
            {c.sourceQuery}
          </p>
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="inline-flex items-center gap-1.5 text-ink-soft">
                <Mail className="h-4 w-4" aria-hidden />
                <span className={masked ? "font-mono text-muted" : "break-all"}>
                  {dc.email}
                </span>
              </span>
              {masked && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  PII minimized (confidential)
                </span>
              )}
            </div>
            {!masked && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <Phone className="h-4 w-4" aria-hidden />
                  <input
                    key={c.id}
                    type="tel"
                    defaultValue={c.phone ?? ""}
                    onBlur={(e) => actions.setCandidatePhone(c.id, e.target.value)}
                    placeholder="Add phone for WhatsApp / SMS"
                    aria-label="Candidate phone number"
                    className="w-56 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink placeholder:text-muted"
                  />
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {c.githubUrl &&
                (masked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 font-mono text-xs font-semibold text-muted">
                    <Github className="h-3.5 w-3.5" aria-hidden />
                    {dc.githubUrl}
                  </span>
                ) : (
                  <a
                    href={dc.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/10"
                  >
                    <Github className="h-3.5 w-3.5" aria-hidden />
                    GitHub
                  </a>
                ))}
              {c.linkedinUrl &&
                (masked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 font-mono text-xs font-semibold text-muted">
                    <Linkedin className="h-3.5 w-3.5" aria-hidden />
                    {dc.linkedinUrl}
                  </span>
                ) : (
                  <a
                    href={dc.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/10"
                  >
                    <Linkedin className="h-3.5 w-3.5" aria-hidden />
                    LinkedIn
                  </a>
                ))}
              {c.sourceUrl &&
                (masked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 font-mono text-xs font-semibold text-muted">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {dc.sourceUrl}
                  </span>
                ) : (
                  <a
                    href={dc.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/10"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {c.sourcePlatform}
                  </a>
                ))}
              {masked && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Eye className="h-4 w-4" />}
                  onClick={handleReveal}
                >
                  Reveal contact (logged)
                </Button>
              )}
            </div>
          </div>
          {hasFlags && (
            <div className="flex flex-wrap gap-1.5">
              {flags.doNotContact && (
                <Badge tone="danger" size="sm" dot>
                  Do not contact
                </Badge>
              )}
              {flags.suppressed && (
                <Badge tone="danger" size="sm" dot>
                  Suppressed
                </Badge>
              )}
              {flags.unsubscribed && (
                <Badge tone="warning" size="sm" dot>
                  Unsubscribed
                </Badge>
              )}
              {flags.anonymized && (
                <Badge tone="violet" size="sm" dot>
                  Anonymized
                </Badge>
              )}
              {flags.gdprExportRequested && (
                <Badge tone="aqua" size="sm" dot>
                  GDPR export requested
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Score */}
        <Section title="Match score" icon={<Sparkles className="h-4 w-4" />}>
          <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="flex justify-center sm:justify-start">
              <ScoreGauge score={c.matchScore} label="Overall fit" />
            </div>
            <ScoreBreakdown breakdown={c.matchBreakdown} />
          </div>
        </Section>

        {/* Tech stack */}
        <Section title="Tech stack">
          <Chips items={c.techStack} label="Tech stack" />
        </Section>

        {/* Experience */}
        <Section title="Experience & background" icon={<Briefcase className="h-4 w-4" />}>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Experience</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink tabular-nums">
                {c.yearsExperience} yrs
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-2">
              <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                <Building2 className="h-3.5 w-3.5" aria-hidden />
                Company stages
              </dt>
              <dd className="mt-1">
                <Chips items={c.companyStageExperience} label="Company stage experience" />
              </dd>
            </div>
          </dl>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Industry</p>
            <Chips items={c.industryExperience} label="Industry experience" />
          </div>
        </Section>

        {/* Recent activity */}
        <Section title="Recent activity" icon={<Clock className="h-4 w-4" />}>
          <p className="text-sm leading-relaxed text-ink-soft">{c.recentActivity}</p>
        </Section>

        {/* Outreach history */}
        <Section title="Outreach history" icon={<Send className="h-4 w-4" />}>
          {c.outreachHistory.length === 0 ? (
            <p className="text-sm text-muted">No outreach sent yet.</p>
          ) : (
            <ul className="space-y-2">
              {c.outreachHistory.map((o) => (
                <li
                  key={o.messageId}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-ink/[0.03] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{o.subject}</p>
                    <p className="text-xs text-muted">
                      {o.channel} · {formatTimeAgo(o.at)}
                    </p>
                  </div>
                  <Badge tone={toneForOutreachStatus(o.status)} size="sm">
                    {o.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Reply history */}
        <Section title="Reply history" icon={<MessageSquare className="h-4 w-4" />}>
          {c.replyHistory.length === 0 ? (
            <p className="text-sm text-muted">No replies received yet.</p>
          ) : (
            <ul className="space-y-2">
              {c.replyHistory.map((r) => (
                <li key={r.id} className="rounded-2xl bg-ink/[0.03] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={toneForIntent(r.intent)} size="sm">
                      {r.intent.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted tabular-nums">
                      {Math.round(r.confidence * 100)}% · {formatTimeAgo(r.at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-soft">{r.excerpt}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Compliance controls */}
        <Section title="Compliance & data governance" icon={<ShieldAlert className="h-4 w-4" />}>
          <p className="text-sm text-muted">
            Honor candidate rights immediately. Export and anonymize support GDPR; suppression and
            do-not-contact enforce exclusion across all outreach.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={handleExport}>
              Export data
            </Button>
            <Button variant="outline" size="sm" leftIcon={<UserX className="h-4 w-4" />} onClick={handleAnonymize}>
              Anonymize
            </Button>
            <Button variant="outline" size="sm" leftIcon={<EyeOff className="h-4 w-4" />} onClick={handleSuppress}>
              Suppress contact
            </Button>
            <Button variant="danger" size="sm" leftIcon={<Ban className="h-4 w-4" />} onClick={handleDoNotContact}>
              Mark do-not-contact
            </Button>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}
