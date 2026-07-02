"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Drawer,
  EmptyState,
  Progress,
  useConfirm,
  useToast,
} from "@/components/ui";
import { StarBadge } from "@/components/tania/badges";
import { useActions, useCampaigns, useChatboxSubmissions } from "@/lib/store";
import { chatboxHandoff, CHATBOX_WEIGHTS } from "@/lib/tania";
import { cn, formatTimeAgo } from "@/lib/utils";
import type { ChatboxSubmission, ChatboxSubmissionStatus } from "@/lib/types";
import { Inbox, MapPin, FileText, ArrowRight, Check, Bookmark } from "lucide-react";

const FILTERS: { key: ChatboxSubmissionStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "reviewed", label: "Reviewed" },
  { key: "advanced", label: "Advanced" },
  { key: "rejected", label: "Rejected" },
];

const STATUS_TONE: Record<ChatboxSubmissionStatus, "tangerine" | "aqua" | "success" | "danger" | "violet"> = {
  new: "tangerine",
  reviewed: "aqua",
  advanced: "success",
  rejected: "danger",
  pooled: "violet",
};

const DIMENSIONS: { key: keyof typeof CHATBOX_WEIGHTS; label: string }[] = [
  { key: "location", label: "Location compatibility" },
  { key: "visa", label: "Visa compatibility" },
  { key: "keySkill", label: "Key skill match" },
  { key: "project", label: "Project requirement match" },
  { key: "availability", label: "Availability / contact" },
];

export function ApplicantInbox() {
  const submissions = useChatboxSubmissions();
  const campaigns = useCampaigns();
  const actions = useActions();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = React.useState<ChatboxSubmissionStatus | "all">("all");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const campaignTitle = React.useMemo(() => {
    const m = new Map<string, string>();
    campaigns.forEach((c) => m.set(c.id, c.title));
    return m;
  }, [campaigns]);

  const filtered = filter === "all" ? submissions : submissions.filter((s) => s.status === filter);
  const sorted = [...filtered].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const open = submissions.find((s) => s.id === openId) ?? null;

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: submissions.length };
    for (const s of submissions) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [submissions]);

  const advance = (s: ChatboxSubmission) => {
    actions.advanceChatboxSubmission(s.id);
    setOpenId(null);
    toast({
      title: `${s.firstName} handed off to the pipeline`,
      description: `Candidate created (${s.starRating}). Now a Lead ready for prequal.`,
      variant: "success",
    });
  };

  const reject = async (s: ChatboxSubmission) => {
    if (!(await confirm({ title: `Reject ${s.firstName} ${s.lastName}?`, description: "Sends a stage-appropriate rejection (batch-approved) and offers the talent pool.", confirmLabel: "Reject + pool", danger: true }))) return;
    actions.setChatboxSubmissionStatus(s.id, "rejected");
    setOpenId(null);
    toast({ title: "Application rejected", description: "Candidate offered the talent pool.", variant: "warning" });
  };

  const markReviewed = (s: ChatboxSubmission) => {
    actions.setChatboxSubmissionStatus(s.id, "reviewed");
    toast({ title: "Marked reviewed", variant: "info" });
  };

  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-6 w-6" />}
        title="No applications yet"
        description="Scored applications from the career-site chatbox land here for the Applicant Screener. Open the public chatbox at /careers to try it."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition",
              filter === f.key ? "bg-electric text-white ring-electric" : "bg-surface/70 text-ink-soft ring-line hover:bg-ink/5",
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-70">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="grid grid-cols-1 gap-3">
        {sorted.map((s) => {
          const handoff = chatboxHandoff(s.starRating);
          return (
            <Card key={s.id} interactive className="cursor-pointer" onClick={() => setOpenId(s.id)}>
              <CardBody className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-xs font-bold text-ink-soft" aria-hidden>
                  {(s.firstName[0] ?? "") + (s.lastName[0] ?? "")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-ink">{s.firstName} {s.lastName}</p>
                    <Badge tone={STATUS_TONE[s.status]} size="sm">{s.status}</Badge>
                    <Badge tone="neutral" size="sm">Path {s.path}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted">
                    {s.roleTitle}{s.campaignId && campaignTitle.get(s.campaignId) ? ` · ${campaignTitle.get(s.campaignId)}` : ""} · {formatTimeAgo(s.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <StarBadge rating={s.starRating} size="sm" />
                    <p className="mt-0.5 text-[0.6875rem] text-muted">{handoff.route}</p>
                  </div>
                  <span className="text-lg font-bold tabular-nums text-ink">{s.score.total}</span>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Scorecard drawer */}
      <Drawer
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? `${open.firstName} ${open.lastName}` : "Applicant"}
        description={open ? `${open.roleTitle} · Path ${open.path} · applied ${formatTimeAgo(open.createdAt)}` : undefined}
        footer={
          open && open.status !== "advanced" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button leftIcon={<ArrowRight className="h-4 w-4" />} onClick={() => advance(open)}>
                Advance to pipeline
              </Button>
              <Button variant="outline" leftIcon={<Check className="h-4 w-4" />} onClick={() => markReviewed(open)}>
                Mark reviewed
              </Button>
              <Button variant="outline" leftIcon={<Bookmark className="h-4 w-4" />} onClick={() => reject(open)}>
                Reject + pool
              </Button>
            </div>
          ) : open ? (
            <p className="text-sm text-success">Handed off to the pipeline as a candidate.</p>
          ) : undefined
        }
      >
        {open && (
          <div className="space-y-6">
            {/* Score header */}
            <div className="flex items-center justify-between rounded-2xl bg-canvas/60 p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Chatbox score</p>
                <p className="text-3xl font-bold tabular-nums text-ink">{open.score.total}<span className="text-lg text-muted">/100</span></p>
              </div>
              <div className="text-right">
                <StarBadge rating={open.starRating} />
                <p className="mt-1 text-xs text-muted">{chatboxHandoff(open.starRating).sla}</p>
              </div>
            </div>

            {/* Dimension breakdown */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Score breakdown</p>
              {DIMENSIONS.map((d) => {
                const val = open.score[d.key];
                const max = CHATBOX_WEIGHTS[d.key];
                return (
                  <div key={d.key}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-ink-soft">{d.label}</span>
                      <span className="tabular-nums text-muted">{val}/{max}</span>
                    </div>
                    <Progress value={(val / max) * 100} tone={val / max >= 0.7 ? "success" : val / max >= 0.4 ? "tangerine" : "danger"} />
                  </div>
                );
              })}
            </div>

            {/* Detected signals */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Detected from CV</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                {open.detected.location && (
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted" />{open.detected.location}</span>
                )}
                {open.cvFileName && (
                  <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5 text-muted" />{open.cvFileName}</span>
                )}
              </div>
              {open.detected.skills && open.detected.skills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {open.detected.skills.map((sk) => (
                    <span key={sk} className="inline-flex rounded-full bg-ink/[0.05] px-2.5 py-1 text-xs font-medium text-ink-soft">{sk}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Screening answers */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Screening answers</p>
              <ul className="space-y-2">
                {open.answers.map((a, i) => (
                  <li key={i} className="rounded-xl bg-ink/[0.03] px-3 py-2 text-sm">
                    <p className="text-muted">{a.question}</p>
                    <p className="font-semibold text-ink">{a.answer}{typeof a.stars === "number" ? ` (${a.stars}★)` : ""}</p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact pref */}
            {open.contactPref && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Contact preference</p>
                <p className="text-sm text-ink-soft">{[open.contactPref.time, open.contactPref.day].filter(Boolean).join(" · ") || "—"}</p>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
