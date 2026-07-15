"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Eyebrow,
  Field,
  Input,
  Progress,
  Select,
  SkeletonCard,
  Tabs,
  TabPanel,
  Textarea,
  useConfirm,
  useToast,
  type TabItem,
} from "@/components/ui";
import { HydrationGate } from "@/components/app/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { StagePipeline } from "@/components/shared/stage-pipeline";
import { ActivityTimeline } from "@/components/shared/activity-timeline";
import { ScoreDistribution } from "@/components/charts/score-distribution";
import { CandidateTable } from "@/components/candidates/candidate-table";
import { CandidateDrawer } from "@/components/candidates/candidate-drawer";
import { AddCandidateButton } from "@/components/candidates/add-candidate-dialog";
import { SourceSillageButton } from "@/components/candidates/source-sillage-dialog";
import { SourceApolloButton } from "@/components/candidates/source-apollo-dialog";
import { SourceSeamlessButton } from "@/components/candidates/source-seamless-dialog";
import { SourcingFeed } from "@/components/tania/sourcing-feed";
import { AgentRunStream } from "@/components/run/agent-run-stream";
import { OutreachMessageCard } from "@/components/outreach/outreach-message-card";
import { RateMeterPanel } from "@/components/outreach/rate-meter-panel";
import { ReplyClassifier } from "@/components/replies/reply-classifier";
import { ReplyCard } from "@/components/replies/reply-card";
import { BookingCalendar } from "@/components/calendar/booking-calendar";
import { InterviewerPanel } from "@/components/calendar/interviewer-panel";
import { WeeklyReportCard } from "@/components/reports/weekly-report-card";
import { SkillUpdateCard } from "@/components/reports/skill-update-card";
import {
  useActions,
  useBookings,
  useCampaign,
  useCampaignCandidates,
  useCampaignOutreach,
  useHydrated,
  useReplies,
  useReportForCampaign,
} from "@/lib/store";
import { campaignHealth, nextActionForCampaign } from "@/lib/rules";
import { campaignAllowsLiveSourcing } from "@/lib/sourcing/campaign-lifecycle";
import type {
  SourcingFeedbackReceipt,
  SourcingFeedbackVerdict,
} from "@/lib/store/contracts";
import {
  copyToClipboard,
  formatNumber,
  formatPercent,
  formatSalaryRange,
  scoreTone,
  toneForUrgency,
  type Tone,
} from "@/lib/utils";
import {
  CANDIDATE_STAGES,
  SENIORITY_LEVELS,
  URGENCY_LEVELS,
  type Campaign,
  type CampaignStatus,
  type Candidate,
  type JobAnalysis,
  type ScoringWeights,
  type ValidationWarning,
} from "@/lib/types";

function mergeSourcingFeedbackReceipts(
  ...groups: SourcingFeedbackReceipt[][]
): SourcingFeedbackReceipt[] {
  const merged = new Map<string, SourcingFeedbackReceipt>();
  for (const group of groups) {
    for (const receipt of group) merged.set(receipt.receiptId, receipt);
  }
  return [...merged.values()];
}
import {
  ArrowLeft,
  Banknote,
  Bot,
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Compass,
  Copy,
  FileSearch,
  GraduationCap,
  LayoutDashboard,
  Linkedin,
  MapPin,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  PlayCircle,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";

const STATUS_TONE: Record<CampaignStatus, Tone> = {
  Intake: "neutral",
  Sourcing: "electric",
  Outreach: "tangerine",
  Interviewing: "violet",
  Closing: "aqua",
  Filled: "success",
  Paused: "warning",
};

const SEVERITY_TONE: Record<ValidationWarning["severity"], Tone> = {
  info: "electric",
  warning: "warning",
  critical: "danger",
};

const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  skills: "Skills match",
  experience: "Experience fit",
  companyStage: "Company-stage fit",
  industry: "Industry overlap",
  location: "Location & timezone",
  activity: "Signal & activity",
};

const WEIGHT_TONES: Tone[] = ["tangerine", "electric", "violet", "aqua", "success", "warning"];

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-ink/45" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted">{label}</dt>
        <dd className="text-sm font-semibold text-ink">{value}</dd>
      </div>
    </div>
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

function yearsLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Not specified";
  if (min != null && max != null) return `${min}–${max} yrs`;
  if (min != null) return `${min}+ yrs`;
  return `Up to ${max} yrs`;
}

function parseSkillList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Edits the fields of the JD that most directly drive scoring and represent
 * "a manager adjusted expectations": required/nice-to-have skills, seniority,
 * minimum experience, and urgency. Saving re-scores this campaign's existing
 * candidates against the updated JD (see updateCampaign in store.ts) instead
 * of leaving them frozen at their original sourcing-time score.
 */
function JdEditForm({
  jd,
  onSave,
  onCancel,
}: {
  jd: JobAnalysis;
  onSave: (patch: Partial<JobAnalysis>) => void;
  onCancel: () => void;
}) {
  const [seniority, setSeniority] = React.useState(jd.seniority);
  const [urgency, setUrgency] = React.useState(jd.urgency);
  const [minYears, setMinYears] = React.useState(jd.minYearsExperience?.toString() ?? "");
  const [required, setRequired] = React.useState(jd.requiredSkills.join(", "));
  const [niceToHave, setNiceToHave] = React.useState(jd.niceToHaveSkills.join(", "));

  const save = () => {
    onSave({
      seniority,
      urgency,
      minYearsExperience: minYears.trim() ? Number(minYears) : null,
      requiredSkills: parseSkillList(required),
      niceToHaveSkills: parseSkillList(niceToHave),
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Seniority" htmlFor="jd-seniority">
          <Select
            id="jd-seniority"
            value={seniority}
            onChange={(e) => setSeniority(e.target.value as JobAnalysis["seniority"])}
            options={SENIORITY_LEVELS.map((s) => ({ value: s, label: s }))}
          />
        </Field>
        <Field label="Urgency" htmlFor="jd-urgency">
          <Select
            id="jd-urgency"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as JobAnalysis["urgency"])}
            options={URGENCY_LEVELS.map((u) => ({ value: u, label: u }))}
          />
        </Field>
        <Field label="Minimum years experience" htmlFor="jd-min-years">
          <Input
            id="jd-min-years"
            type="number"
            min={0}
            value={minYears}
            onChange={(e) => setMinYears(e.target.value)}
            placeholder="No minimum"
          />
        </Field>
      </div>
      <Field label="Required skills (comma-separated)" htmlFor="jd-required-skills">
        <Textarea id="jd-required-skills" rows={2} value={required} onChange={(e) => setRequired(e.target.value)} />
      </Field>
      <Field label="Nice-to-have skills (comma-separated)" htmlFor="jd-nice-to-have">
        <Textarea id="jd-nice-to-have" rows={2} value={niceToHave} onChange={(e) => setNiceToHave(e.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save}>
          Save &amp; re-score candidates
        </Button>
        <Button size="sm" variant="ghost" leftIcon={<X className="h-3.5 w-3.5" />} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Edits the six scoring-weight dimensions. Saving re-scores this campaign's existing candidates. */
function WeightsEditForm({
  weights,
  onSave,
  onCancel,
}: {
  weights: ScoringWeights;
  onSave: (patch: ScoringWeights) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState<Record<keyof ScoringWeights, string>>(
    Object.fromEntries(
      (Object.keys(weights) as (keyof ScoringWeights)[]).map((k) => [k, String(weights[k])]),
    ) as Record<keyof ScoringWeights, string>,
  );

  const save = () => {
    const next = Object.fromEntries(
      (Object.keys(draft) as (keyof ScoringWeights)[]).map((k) => [k, Math.max(0, Number(draft[k]) || 0)]),
    ) as unknown as ScoringWeights;
    onSave(next);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(draft) as (keyof ScoringWeights)[]).map((key) => (
          <Field key={key} label={WEIGHT_LABELS[key]} htmlFor={`weight-${key}`}>
            <Input
              id={`weight-${key}`}
              type="number"
              min={0}
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save}>
          Save &amp; re-score candidates
        </Button>
        <Button size="sm" variant="ghost" leftIcon={<X className="h-3.5 w-3.5" />} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const hydrated = useHydrated();
  const campaign = useCampaign(id);
  const candidates = useCampaignCandidates(id);
  const outreach = useCampaignOutreach(id);
  const allReplies = useReplies();
  const allBookings = useBookings();
  const report = useReportForCampaign(id);
  const actions = useActions();
  const { toast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  const [tab, setTab] = React.useState("overview");
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [stageFilter, setStageFilter] = React.useState("all");
  const [scoreFilter, setScoreFilter] = React.useState("all");
  const [agentRunning, setAgentRunning] = React.useState(false);
  const [feedbackState, setFeedbackState] = React.useState<{
    campaignId: string;
    receipts: SourcingFeedbackReceipt[];
  }>({ campaignId: id, receipts: [] });
  const feedbackReceipts = feedbackState.campaignId === id ? feedbackState.receipts : [];
  const [feedbackSubmitting, setFeedbackSubmitting] = React.useState<Set<string>>(new Set());
  const [sourcing, setSourcing] = React.useState(false);
  // The just-sourced batch, staged for the streaming reveal below — purely a
  // display buffer; the store already committed these candidates for real.
  // `sourceBatchKey` remounts <SourcingFeed> on every new batch (even one of
  // the same size as the last) so the reveal always replays from the top.
  const [justSourced, setJustSourced] = React.useState<Candidate[]>([]);
  const [sourceBatchKey, setSourceBatchKey] = React.useState(0);
  const [bookingCandidateId, setBookingCandidateId] = React.useState<string | null>(null);
  const [editingJd, setEditingJd] = React.useState(false);
  const [editingWeights, setEditingWeights] = React.useState(false);
  // "Watch Aria Work" panel — remounted (via runToken as its key) on every
  // "Run Aria" click so each click starts a genuinely fresh, replayable run.
  const [runOpen, setRunOpen] = React.useState(false);
  const [runToken, setRunToken] = React.useState(0);

  React.useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setFeedbackState((current) =>
      current.campaignId === id ? current : { campaignId: id, receipts: [] },
    );
    void actions.listPendingSourcingFeedback(id).then((receipts) => {
      if (cancelled || receipts === null) return;
      setFeedbackState((current) =>
        current.campaignId === id
          ? {
              campaignId: id,
              receipts: mergeSourcingFeedbackReceipts(current.receipts, receipts),
            }
          : current,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [actions, hydrated, id]);

  if (!hydrated) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!campaign) {
    return (
      <EmptyState
        icon={<FileSearch className="h-6 w-6" />}
        title="Campaign not found"
        description="This campaign may have been reset or never existed. Head back to the campaign list to pick another role."
        action={
          <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push("/campaigns")}>
            Back to campaigns
          </Button>
        }
      />
    );
  }

  const c: Campaign = campaign;
  const liveSourcingAllowed = campaignAllowsLiveSourcing(c.status);
  const m = c.metrics;
  const jd = c.jobAnalysis;
  const strategy = c.sourcingStrategy;
  const health = campaignHealth(c);
  const nextAction = nextActionForCampaign(c);
  const scores = candidates.map((cand) => cand.matchScore);
  const campaignReplies = allReplies.filter((r) => r.campaignId === c.id);
  const campaignBookings = allBookings.filter((b) => b.campaignId === c.id);
  const interestedAwaiting = candidates.filter((cand) => cand.stage === "Interested" && !cand.booking);

  const needsApproval = outreach
    .filter((mm) => mm.status === "Needs Approval")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const pendingManual = outreach
    .filter((mm) => mm.status === "Pending Manual Send")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const otherOutreach = outreach
    .filter((mm) => mm.status !== "Needs Approval" && mm.status !== "Pending Manual Send")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const sortedReplies = [...campaignReplies].sort((a, b) => {
    const hot = (r: typeof a) =>
      !r.handled && (r.intent === "INTERESTED" || r.intent === "QUALIFIED_INTEREST") ? 1 : 0;
    if (hot(a) !== hot(b)) return hot(b) - hot(a);
    return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
  });

  const filteredCandidates = candidates.filter((cand) => {
    if (stageFilter !== "all" && cand.stage !== stageFilter) return false;
    if (scoreFilter !== "all" && cand.matchScore < Number(scoreFilter)) return false;
    return true;
  });

  const weightTotal = Object.values(c.scoringWeights).reduce((a, b) => a + b, 0) || 1;

  const tabs: TabItem[] = [
    { value: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
    { value: "jd", label: "JD Analysis", icon: <FileSearch className="h-4 w-4" /> },
    { value: "strategy", label: "Sourcing Strategy", icon: <Compass className="h-4 w-4" /> },
    { value: "candidates", label: "Candidates", icon: <Users className="h-4 w-4" />, count: candidates.length },
    { value: "outreach", label: "Outreach", icon: <Send className="h-4 w-4" />, count: outreach.length },
    { value: "replies", label: "Replies", icon: <MessageSquare className="h-4 w-4" />, count: campaignReplies.length },
    { value: "booking", label: "Booking", icon: <CalendarCheck className="h-4 w-4" />, count: campaignBookings.length },
    { value: "learning", label: "Learning", icon: <GraduationCap className="h-4 w-4" /> },
  ];

  const idBase = `campaign-${c.id}`;

  const copy = async (text: string, what: string) => {
    const ok = await copyToClipboard(text);
    toast({
      title: ok ? `${what} copied` : "Copy failed",
      description: ok ? "Pasted to your clipboard." : "Clipboard is unavailable in this browser.",
      variant: ok ? "success" : "error",
    });
  };

  const handleSource = async () => {
    if (sourcing) return;
    setSourcing(true);
    const res = await actions.sourceNextBatch(c.id);
    setSourcing(false);
    if (!res.ok) {
      toast({
        title: res.source === "paused" ? "Campaign is paused" : "Sourcing failed",
        description: res.error,
        variant: "error",
      });
      return;
    }
    setFeedbackState((current) =>
      current.campaignId === c.id
        ? {
            campaignId: c.id,
            receipts: mergeSourcingFeedbackReceipts(
              current.receipts,
              res.feedbackReceipts ?? [],
            ),
          }
        : current,
    );
    // Stage the reveal with the exact, already-committed batch — never a
    // re-derived or re-scored copy — and jump to the Candidates tab so the
    // stream is immediately visible instead of resolving behind a toast.
    setJustSourced(res.accepted);
    setSourceBatchKey((k) => k + 1);
    if (res.accepted.length > 0) setTab("candidates");
    const isLive = res.source === "github" || res.source === "web";
    if (res.accepted.length === 0) {
      toast({
        title: "No candidates were added",
        description: res.skipped.length
          ? `${res.skipped.length} real results were excluded or already present.`
          : "The real search completed without a matching result.",
        variant: "info",
      });
      return;
    }
    toast({
      title: `Sourced ${res.accepted.length} candidate${res.accepted.length === 1 ? "" : "s"}${isLive ? " (live)" : ""}`,
      description: res.skipped.length
        ? `${res.skipped.length} skipped by dedupe and exclusion rules.`
        : isLive
          ? `Live results from ${res.source === "github" ? "GitHub" : "the web"}.`
          : "All matched candidates accepted into the pipeline.",
      variant: "success",
    });
  };

  const handleRunAgent = async () => {
    const campaignId = c.id;
    setAgentRunning(true);
    const res = await actions.runSourcingAgent(campaignId);
    setAgentRunning(false);
    if (!res.ok) {
      toast({ title: "Sourcing agent didn't run", description: res.error, variant: "error" });
      return;
    }
    setFeedbackState((current) =>
      current.campaignId === campaignId
        ? {
            campaignId,
            receipts: mergeSourcingFeedbackReceipts(
              current.receipts,
              res.feedbackReceipts ?? [],
            ),
          }
        : current,
    );
    if (res.added === 0) {
      toast({
        title: "No candidates were added",
        description:
          res.mode === "cloud"
            ? "The real provider search completed, but every result was empty, excluded, or already present."
            : "The reviewed GitHub queries completed, but every result was empty, excluded, or already present. No cloud model ran.",
        variant: "info",
      });
      return;
    }
    toast({
      title:
        res.mode === "cloud"
          ? `Cloud sourcing agent found ${res.added} candidate${res.added === 1 ? "" : "s"}`
          : `GitHub search found ${res.added} candidate${res.added === 1 ? "" : "s"}`,
      description:
        res.mode === "cloud"
          ? "Real provider search and cloud-assisted drafts are ready for human review."
          : "Real GitHub results and locally generated drafts are ready for human review. No cloud model ran.",
      variant: "success",
    });
  };

  const handleSourcingFeedback = async (
    receipt: SourcingFeedbackReceipt,
    verdict: SourcingFeedbackVerdict,
  ) => {
    if (feedbackSubmitting.has(receipt.receiptId)) return;
    setFeedbackSubmitting((current) => new Set(current).add(receipt.receiptId));
    const recorded = await actions.recordSourcingFeedback(receipt.receiptId, verdict);
    setFeedbackSubmitting((current) => {
      const next = new Set(current);
      next.delete(receipt.receiptId);
      return next;
    });
    if (!recorded) {
      toast({
        title: "Feedback was not saved",
        description: "The learning receipt is unavailable or was already reviewed differently.",
        variant: "error",
      });
      return;
    }
    setFeedbackState((current) =>
      current.campaignId === c.id
        ? {
            campaignId: c.id,
            receipts: current.receipts.filter(
              (item) => item.receiptId !== receipt.receiptId,
            ),
          }
        : current,
    );
    toast({
      title: "Sourcing feedback saved",
      description: "This aggregate result can inform a future human-reviewed sourcing lesson.",
      variant: "success",
    });
  };

  const handleOpenRun = () => {
    setRunOpen(true);
    setRunToken((k) => k + 1);
  };

  const handlePause = () => {
    if (!actions.updateCampaign(c.id, { status: "Paused", previousStatus: c.status })) {
      toast({ title: "Campaign not changed", description: "Your workspace is unavailable or your access is read-only.", variant: "error" });
      return;
    }
    toast({
      title: "Campaign paused",
      description: "Sourcing and new outreach drafts are blocked until you resume.",
      variant: "warning",
    });
  };

  const handleResume = () => {
    const restored: CampaignStatus = c.previousStatus ?? "Sourcing";
    if (!actions.updateCampaign(c.id, { status: restored, previousStatus: null })) {
      toast({ title: "Campaign not changed", description: "Your workspace is unavailable or your access is read-only.", variant: "error" });
      return;
    }
    toast({
      title: "Campaign resumed",
      description: `Status restored to ${restored}.`,
      variant: "success",
    });
  };

  const handleMarkFilled = async () => {
    const proceed = await confirm({
      title: `Mark "${c.title}" as filled?`,
      description: "This closes the campaign. Sourcing and outreach will stop until it's reopened.",
      confirmLabel: "Mark filled",
      danger: true,
    });
    if (!proceed) return;
    if (!actions.updateCampaign(c.id, { status: "Filled", previousStatus: null })) {
      toast({ title: "Campaign not changed", description: "Your workspace is unavailable or your access is read-only.", variant: "error" });
      return;
    }
    toast({
      title: "Campaign marked Filled",
      description: `${c.title} is now marked as filled.`,
      variant: "success",
    });
  };

  const handleReopen = () => {
    if (!actions.updateCampaign(c.id, { status: "Sourcing" })) {
      toast({ title: "Campaign not changed", description: "Your workspace is unavailable or your access is read-only.", variant: "error" });
      return;
    }
    toast({
      title: "Campaign reopened",
      description: `${c.title} is back to Sourcing.`,
      variant: "success",
    });
  };

  const handleMoreQueries = () => {
    if (!actions.regenerateQueries(c.id)) {
      toast({ title: "Query not generated", description: "Your workspace is unavailable or your access is read-only.", variant: "error" });
      return;
    }
    toast({
      title: "New sourcing query generated",
      description: "Added an adjacent query to widen the search.",
      variant: "success",
    });
  };

  const handleBook = async (cand: Candidate) => {
    if (bookingCandidateId) return;
    setBookingCandidateId(cand.id);
    const res = await actions.createBookingFor(cand.id);
    setBookingCandidateId(null);
    if (res.ok) {
      toast({
        title: `Interview booked: ${cand.name}`,
        description: `With ${res.booking.interviewer || "an interviewer to be confirmed"}. ${res.booking.calLink || res.booking.teamsLink ? "Calendar link confirmed." : "Meeting link pending calendar provider confirmation."}`,
        variant: "success",
      });
    } else {
      toast({ title: "Could not book interview", description: res.error, variant: "error" });
    }
  };

  const handleReport = () => {
    const r = actions.generateReport(c.id);
    if (r) {
      toast({
        title: "Weekly report generated",
        description: `${r.skillUpdates.length} skill update${r.skillUpdates.length === 1 ? "" : "s"} proposed.`,
        variant: "success",
      });
    } else {
      toast({ title: "Could not generate report", variant: "error" });
    }
  };

  const openCandidate = (cand: Candidate) => {
    setSelected(cand);
    setDrawerOpen(true);
  };

  const handleSaveJd = (patch: Partial<JobAnalysis>) => {
    const candidateCount = candidates.length;
    if (!actions.updateCampaign(c.id, { jobAnalysis: { ...c.jobAnalysis, ...patch } })) {
      toast({ title: "Requirements not changed", description: "Your workspace is unavailable or your access is read-only.", variant: "error" });
      return;
    }
    setEditingJd(false);
    toast({
      title: "Requirements updated",
      description: candidateCount
        ? `${candidateCount} candidate${candidateCount === 1 ? "" : "s"} re-scored against the updated JD.`
        : "No candidates sourced yet to re-score.",
      variant: "success",
    });
  };

  const handleSaveWeights = (patch: ScoringWeights) => {
    const candidateCount = candidates.length;
    if (!actions.updateCampaign(c.id, { scoringWeights: patch })) {
      toast({ title: "Weights not changed", description: "Your workspace is unavailable or your access is read-only.", variant: "error" });
      return;
    }
    setEditingWeights(false);
    toast({
      title: "Scoring weights updated",
      description: candidateCount
        ? `${candidateCount} candidate${candidateCount === 1 ? "" : "s"} re-scored with the new weights.`
        : "No candidates sourced yet to re-score.",
      variant: "success",
    });
  };

  const overviewMetrics: {
    label: string;
    value: string | number;
    hint: string;
    icon: React.ReactNode;
    tone: Tone;
  }[] = [
    { label: "Sourced", value: formatNumber(m.sourced), hint: "Candidates in the pool", icon: <Users />, tone: "electric" },
    { label: "Contacted", value: formatNumber(m.contacted), hint: "Outreach delivered", icon: <Send />, tone: "tangerine" },
    { label: "Reply rate", value: formatPercent(m.replyRate), hint: "Replies per contact", icon: <MessageSquare />, tone: "aqua" },
    { label: "Interested", value: formatNumber(m.interested), hint: "Positive intent", icon: <Sparkles />, tone: "tangerine" },
    { label: "Booked", value: formatNumber(m.booked), hint: "Interviews scheduled", icon: <CalendarCheck />, tone: "violet" },
    { label: "Avg match", value: m.avgMatchScore, hint: "Mean fit score", icon: <Target />, tone: scoreTone(m.avgMatchScore) },
  ];

  const jdItems: { label: string; value: React.ReactNode }[] = [
    { label: "Title", value: jd.title },
    { label: "Department", value: jd.department },
    { label: "Seniority", value: jd.seniority },
    { label: "Employment", value: jd.employmentType },
    { label: "Location type", value: jd.locationType },
    { label: "Regions", value: jd.regions.join(", ") || "—" },
    { label: "Timezone", value: jd.timezone },
    { label: "Salary", value: formatSalaryRange(jd.salaryMin, jd.salaryMax, jd.currency) },
    { label: "Equity", value: jd.equity ? "Yes" : "No" },
    { label: "Experience", value: yearsLabel(jd.minYearsExperience, jd.maxYearsExperience) },
    { label: "Education", value: jd.education || "—" },
    { label: "Team size", value: jd.teamSize || "—" },
    { label: "Reporting to", value: jd.reportingTo || "—" },
    { label: "Urgency", value: jd.urgency },
  ];

  const stageOptions = [
    { value: "all", label: "All stages" },
    ...CANDIDATE_STAGES.map((s) => ({ value: s, label: s })),
  ];
  const scoreOptions = [
    { value: "all", label: "Any score" },
    { value: "85", label: "85+ exceptional" },
    { value: "70", label: "70+ strong" },
    { value: "55", label: "55+ viable" },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-5">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-muted transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All campaigns
        </Link>
      </div>

      {/* High-impact header */}
      <Card className="relative mb-6 overflow-hidden p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Eyebrow>{c.department}</Eyebrow>
            <h1 className="display mt-2 text-3xl text-ink sm:text-4xl">{c.title}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone={toneForUrgency(c.urgency)} dot>
                {c.urgency}
              </Badge>
              <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              <Badge tone={health.tone} dot title={health.detail}>
                {health.label}
              </Badge>
            </div>
            <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <MetaItem
                icon={<UserRound className="h-4 w-4" />}
                label="Hiring manager"
                value={
                  <span className="block">
                    {c.hiringManager}
                    <span className="block text-xs font-normal text-muted">{c.hiringManagerEmail}</span>
                  </span>
                }
              />
              <MetaItem
                icon={<Banknote className="h-4 w-4" />}
                label="Salary range"
                value={formatSalaryRange(jd.salaryMin, jd.salaryMax, jd.currency)}
              />
              <MetaItem
                icon={<MapPin className="h-4 w-4" />}
                label="Location"
                value={`${jd.locationType}${jd.regions.length ? ` · ${jd.regions.join(", ")}` : ""}`}
              />
            </dl>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:max-w-[55%] lg:justify-end">
            <Button
              variant="secondary"
              leftIcon={<Sparkles className="h-4 w-4" />}
              onClick={handleSource}
              loading={sourcing}
              disabled={sourcing || !liveSourcingAllowed}
              title={!liveSourcingAllowed ? "Move the campaign to Sourcing or Outreach to source candidates" : undefined}
            >
              {sourcing ? "Sourcing…" : "Source next batch"}
            </Button>
            <Button
              variant="secondary"
              leftIcon={<Bot className="h-4 w-4" />}
              onClick={handleRunAgent}
              disabled={agentRunning || !liveSourcingAllowed}
              title={!liveSourcingAllowed ? "Move the campaign to Sourcing or Outreach to run the sourcing agent" : undefined}
            >
              {agentRunning ? "Agent working…" : "Run sourcing agent"}
            </Button>
            <SourceSillageButton campaignId={c.id} disabled={!liveSourcingAllowed} />
            <SourceApolloButton campaignId={c.id} disabled={!liveSourcingAllowed} />
            <SourceSeamlessButton campaignId={c.id} disabled={!liveSourcingAllowed} />
            <Button
              variant="primary"
              leftIcon={<PlayCircle className="h-4 w-4" />}
              onClick={handleOpenRun}
              disabled={!liveSourcingAllowed}
              title={!liveSourcingAllowed ? "Move the campaign to Sourcing or Outreach to run Aria" : undefined}
            >
              Run Aria
            </Button>
            <Button
              variant="outline"
              leftIcon={<Send className="h-4 w-4" />}
              onClick={() => router.push(`/outreach?campaign=${c.id}`)}
            >
              Review outreach
            </Button>
            {c.status === "Paused" ? (
              <Button variant="primary" leftIcon={<Play className="h-4 w-4" />} onClick={handleResume}>
                Resume campaign
              </Button>
            ) : (
              <Button variant="outline" leftIcon={<Pause className="h-4 w-4" />} onClick={handlePause}>
                Pause campaign
              </Button>
            )}
            {c.status === "Filled" ? (
              <Button variant="outline" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={handleReopen}>
                Reopen
              </Button>
            ) : (
              <Button variant="outline" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={handleMarkFilled}>
                Mark filled
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 border-t border-line pt-4 text-sm">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tangerine-soft text-tangerine" aria-hidden>
            <Compass className="h-3.5 w-3.5" />
          </span>
          <span className="text-muted">Next best action</span>
          <span className="font-semibold text-ink">{nextAction}</span>
        </div>
      </Card>

      {feedbackReceipts.length > 0 && (
        <Card className="mb-6" aria-label="Sourcing lesson feedback">
          <CardHeader>
            <Eyebrow>Private role learning</Eyebrow>
            <CardTitle className="mt-1">Were these real searches useful?</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-muted">
              Feedback stores aggregate query outcomes only. It never sends candidate profiles to Graphify,
              and no lesson can go live without a separate admin review.
            </p>
            {feedbackReceipts.map((receipt) => {
              const submitting = feedbackSubmitting.has(receipt.receiptId);
              return (
                <div
                  key={receipt.receiptId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3"
                >
                  <p className="text-sm font-medium text-ink">
                    {receipt.platform}: {receipt.candidateCount} real candidate{receipt.candidateCount === 1 ? "" : "s"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={submitting}
                      onClick={() => void handleSourcingFeedback(receipt, "useful")}
                    >
                      Useful
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => void handleSourcingFeedback(receipt, "dead_end")}
                    >
                      Dead end
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={submitting}
                      onClick={() => void handleSourcingFeedback(receipt, "corrected")}
                    >
                      Needs correction
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}

      {runOpen && (
        <AgentRunStream
          key={runToken}
          campaignId={c.id}
          autoStart
          onClose={() => setRunOpen(false)}
          className="mb-6 animate-fade-in"
        />
      )}

      <Tabs items={tabs} value={tab} onValueChange={setTab} idBase={idBase} className="mb-6" />

      {/* Overview */}
      <TabPanel value="overview" active={tab === "overview"} idBase={idBase}>
        <div className="space-y-6">
          <StagePipeline metrics={m} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {overviewMetrics.map((mc) => (
              <MetricCard key={mc.label} label={mc.label} value={mc.value} hint={mc.hint} icon={mc.icon} tone={mc.tone} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <Eyebrow>Match quality</Eyebrow>
                <CardTitle className="mt-1">Score distribution</CardTitle>
              </CardHeader>
              <CardBody>
                <ScoreDistribution scores={scores} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <Eyebrow>Risk radar</Eyebrow>
                <CardTitle className="mt-1">Top risks</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="flex items-start gap-2 rounded-2xl bg-ink/[0.03] p-3">
                  <Badge tone={health.tone} dot size="sm">
                    {health.label}
                  </Badge>
                  <p className="text-sm text-ink-soft">{health.detail}</p>
                </div>
                {jd.validationWarnings.length === 0 ? (
                  <p className="text-sm text-muted">No outstanding validation warnings on this role.</p>
                ) : (
                  <ul className="space-y-2">
                    {jd.validationWarnings.map((w, i) => (
                      <li key={`${w.field}-${i}`} className="rounded-2xl border border-line p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{w.field}</span>
                          <Badge tone={SEVERITY_TONE[w.severity]} size="sm">
                            {w.severity}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-ink-soft">{w.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <Eyebrow>Audit trail</Eyebrow>
              <CardTitle className="mt-1">Campaign activity</CardTitle>
            </CardHeader>
            <CardBody>
              <ActivityTimeline
                activities={c.activities}
                emptyHint="Source a batch and generate outreach to start the campaign timeline."
              />
            </CardBody>
          </Card>
        </div>
      </TabPanel>

      {/* JD Analysis */}
      <TabPanel value="jd" active={tab === "jd"} idBase={idBase}>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex items-center justify-between gap-3">
              <div>
                <Eyebrow>Parsed requirement</Eyebrow>
                <CardTitle className="mt-1">Role specification</CardTitle>
              </div>
              {!editingJd && (
                <Button size="sm" variant="ghost" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditingJd(true)}>
                  Edit requirements
                </Button>
              )}
            </CardHeader>
            <CardBody>
              {editingJd ? (
                <JdEditForm jd={jd} onSave={handleSaveJd} onCancel={() => setEditingJd(false)} />
              ) : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                  {jdItems.map((item) => (
                    <div key={item.label}>
                      <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted">{item.label}</dt>
                      <dd className="mt-0.5 text-sm font-semibold text-ink">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <Eyebrow>Assumptions</Eyebrow>
              <CardTitle className="mt-1">Validation</CardTitle>
            </CardHeader>
            <CardBody>
              {jd.validationWarnings.length === 0 ? (
                <p className="text-sm text-muted">Clean parse. No assumptions flagged for review.</p>
              ) : (
                <ul className="space-y-2">
                  {jd.validationWarnings.map((w, i) => (
                    <li key={`${w.field}-${i}`} className="rounded-2xl border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{w.field}</span>
                        <Badge tone={SEVERITY_TONE[w.severity]} size="sm">
                          {w.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">{w.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card className="lg:col-span-3">
            <CardBody className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2.5">
                <Eyebrow>Required skills</Eyebrow>
                <Chips items={jd.requiredSkills} label="Required skills" />
              </div>
              <div className="space-y-2.5">
                <Eyebrow>Nice to have</Eyebrow>
                <Chips items={jd.niceToHaveSkills} label="Nice to have skills" />
              </div>
              <div className="space-y-2.5">
                <Eyebrow>Industry experience</Eyebrow>
                <Chips items={jd.industryExperience} label="Industry experience" />
              </div>
              <div className="space-y-2.5">
                <Eyebrow>Company-stage target</Eyebrow>
                <Chips items={jd.companyStageTarget} label="Company-stage target" />
              </div>
            </CardBody>
          </Card>
        </div>
      </TabPanel>

      {/* Sourcing Strategy */}
      <TabPanel value="strategy" active={tab === "strategy"} idBase={idBase}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Eyebrow>Where Aria looks</Eyebrow>
              <h2 className="text-xl font-bold tracking-tight text-ink">Sourcing strategy</h2>
            </div>
            <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={handleMoreQueries}>
              Generate more queries
            </Button>
          </div>

          <Card>
            <CardBody className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <Eyebrow className="mb-1.5 block">Primary platforms</Eyebrow>
                <div className="flex flex-wrap gap-1.5">
                  {strategy.primaryPlatforms.map((p) => (
                    <Badge key={p} tone="tangerine" size="sm" dot>
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <Eyebrow className="mb-1.5 block">Secondary platforms</Eyebrow>
                <div className="flex flex-wrap gap-1.5">
                  {strategy.secondaryPlatforms.length === 0 ? (
                    <span className="text-sm text-muted">None</span>
                  ) : (
                    strategy.secondaryPlatforms.map((p) => (
                      <Badge key={p} tone="electric" size="sm">
                        {p}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {strategy.githubQueries.map((gq, i) => (
              <Card key={`${gq.label}-${i}`}>
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Eyebrow>GitHub query</Eyebrow>
                      <p className="mt-1 font-semibold text-ink">{gq.label}</p>
                    </div>
                    <Badge tone="aqua" size="sm">
                      ~{formatNumber(gq.estimatedResults)} results
                    </Badge>
                  </div>
                  <p className="break-words rounded-2xl bg-ink/[0.03] px-3 py-2 font-mono text-xs text-ink-soft">
                    {gq.query}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Copy className="h-3.5 w-3.5" />}
                    onClick={() => copy(gq.query, "Query")}
                  >
                    Copy query
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Eyebrow>LinkedIn</Eyebrow>
                  <p className="mt-1 font-semibold text-ink">Boolean search string</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Copy className="h-3.5 w-3.5" />}
                  onClick={() => copy(strategy.linkedinBoolean, "Boolean string")}
                >
                  Copy
                </Button>
              </div>
              <p className="break-words rounded-2xl bg-ink/[0.03] px-3 py-2 font-mono text-xs text-ink-soft">
                {strategy.linkedinBoolean || "No boolean string generated."}
              </p>
            </CardBody>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardBody className="space-y-2.5">
                <Eyebrow>Stack Overflow tags</Eyebrow>
                <Chips items={strategy.stackOverflowTags} label="Stack Overflow tags" />
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-2.5">
                <Eyebrow>Geo targets</Eyebrow>
                <Chips items={strategy.geoTargets} label="Geo targets" />
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-2.5">
                <Eyebrow>Excluded companies</Eyebrow>
                <Chips items={strategy.excludedCompanies} label="Excluded companies" />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <div>
                <Eyebrow>Ranking</Eyebrow>
                <CardTitle className="mt-1">Scoring weights</CardTitle>
              </div>
              {!editingWeights && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => setEditingWeights(true)}
                >
                  Edit weights
                </Button>
              )}
            </CardHeader>
            <CardBody className="space-y-4">
              {editingWeights ? (
                <WeightsEditForm
                  weights={c.scoringWeights}
                  onSave={handleSaveWeights}
                  onCancel={() => setEditingWeights(false)}
                />
              ) : (
                (Object.keys(c.scoringWeights) as (keyof ScoringWeights)[]).map((key, i) => {
                  const raw = c.scoringWeights[key];
                  const pct = Math.round((raw / weightTotal) * 100);
                  return (
                    <div key={key} className="space-y-1.5">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-semibold text-ink-soft">{WEIGHT_LABELS[key]}</span>
                        <span className="font-bold tabular-nums text-ink">{pct}%</span>
                      </div>
                      <Progress
                        value={pct}
                        tone={WEIGHT_TONES[i % WEIGHT_TONES.length]}
                        aria-label={`${WEIGHT_LABELS[key]} weight ${pct}%`}
                      />
                    </div>
                  );
                })
              )}
            </CardBody>
          </Card>
        </div>
      </TabPanel>

      {/* Candidates */}
      <TabPanel value="candidates" active={tab === "candidates"} idBase={idBase}>
        <div className="space-y-6">
          {justSourced.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Eyebrow>Just sourced</Eyebrow>
                <Badge tone="electric" size="sm">
                  {justSourced.length}
                </Badge>
              </div>
              <SourcingFeed key={sourceBatchKey} candidates={justSourced} campaignId={c.id} />
            </div>
          )}

          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Stage" htmlFor="cand-stage">
                <Select
                  id="cand-stage"
                  options={stageOptions}
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                />
              </Field>
              <Field label="Minimum score" htmlFor="cand-score">
                <Select
                  id="cand-score"
                  options={scoreOptions}
                  value={scoreFilter}
                  onChange={(e) => setScoreFilter(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap items-end justify-between gap-3 text-sm text-muted sm:col-span-2 lg:col-span-2">
                <span>
                  Showing <span className="mx-1 font-semibold text-ink">{filteredCandidates.length}</span> of{" "}
                  {candidates.length}. Open a candidate to score, generate outreach, or book.
                </span>
                <AddCandidateButton campaignId={c.id} />
              </div>
            </CardBody>
          </Card>

          <Card className="overflow-x-auto">
            <CardBody>
              <CandidateTable candidates={filteredCandidates} onSelect={openCandidate} />
            </CardBody>
          </Card>
        </div>
      </TabPanel>

      {/* Outreach */}
      <TabPanel value="outreach" active={tab === "outreach"} idBase={idBase}>
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            {outreach.length === 0 ? (
              <EmptyState
                icon={<Send className="h-6 w-6" />}
                title="No outreach drafted yet"
                description="Open a candidate and generate a message. It lands in the approval queue before anything is scheduled."
              />
            ) : (
              <>
                {needsApproval.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Eyebrow>Needs approval</Eyebrow>
                      <Badge tone="warning" size="sm">
                        {needsApproval.length}
                      </Badge>
                    </div>
                    {needsApproval.map((msg) => (
                      <OutreachMessageCard key={msg.id} message={msg} />
                    ))}
                  </section>
                )}
                {pendingManual.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Linkedin className="h-4 w-4 text-tangerine" aria-hidden />
                      <Eyebrow>Pending manual send</Eyebrow>
                      <Badge tone="tangerine" size="sm">
                        {pendingManual.length}
                      </Badge>
                    </div>
                    {pendingManual.map((msg) => (
                      <OutreachMessageCard key={msg.id} message={msg} />
                    ))}
                  </section>
                )}
                {otherOutreach.length > 0 && (
                  <section className="space-y-4">
                    <Eyebrow>Drafts &amp; scheduled</Eyebrow>
                    {otherOutreach.map((msg) => (
                      <OutreachMessageCard key={msg.id} message={msg} />
                    ))}
                  </section>
                )}
              </>
            )}
          </div>
          <div className="lg:sticky lg:top-6 lg:self-start">
            <RateMeterPanel campaign={c} />
          </div>
        </div>
      </TabPanel>

      {/* Replies */}
      <TabPanel value="replies" active={tab === "replies"} idBase={idBase}>
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="lg:sticky lg:top-6 lg:self-start">
            <ReplyClassifier campaignId={c.id} />
          </div>
          <div className="space-y-4">
            {sortedReplies.length === 0 ? (
              <EmptyState
                icon={<MessageSquare className="h-6 w-6" />}
                title="No replies yet"
                description="Classified replies land here. Paste a reply on the left to triage intent and draft a response."
              />
            ) : (
              sortedReplies.map((reply) => <ReplyCard key={reply.id} reply={reply} />)
            )}
          </div>
        </div>
      </TabPanel>

      {/* Booking */}
      <TabPanel value="booking" active={tab === "booking"} idBase={idBase}>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex items-center justify-between gap-2">
                <div>
                  <Eyebrow>Ready to book</Eyebrow>
                  <CardTitle className="mt-1">Interested awaiting booking</CardTitle>
                </div>
                <Badge tone="tangerine" size="sm">
                  {interestedAwaiting.length}
                </Badge>
              </CardHeader>
              <CardBody>
                {interestedAwaiting.length === 0 ? (
                  <p className="text-sm text-muted">
                    No interested candidates waiting. As replies turn positive, they appear here ready to schedule.
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {interestedAwaiting.map((cand) => (
                      <li
                        key={cand.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{cand.name}</p>
                          <p className="truncate text-xs text-muted">
                            {cand.currentTitle} · match {Math.round(cand.matchScore)}
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<CalendarPlus className="h-4 w-4" />}
                          onClick={() => handleBook(cand)}
                          loading={bookingCandidateId === cand.id}
                          disabled={bookingCandidateId !== null}
                        >
                          Book
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <BookingCalendar bookings={campaignBookings} />
          </div>

          <div className="lg:sticky lg:top-6 lg:self-start">
            <InterviewerPanel />
          </div>
        </div>
      </TabPanel>

      {/* Learning */}
      <TabPanel value="learning" active={tab === "learning"} idBase={idBase}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Eyebrow>Self-improvement</Eyebrow>
              <h2 className="text-xl font-bold tracking-tight text-ink">Learning &amp; refinement</h2>
            </div>
            <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={handleReport}>
              {report ? "Regenerate report" : "Generate report"}
            </Button>
          </div>

          {report ? (
            <WeeklyReportCard report={report} />
          ) : (
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title="No weekly report yet"
              description="Generate a report to see the funnel, winning patterns, and proposed skill refinements for this campaign."
              action={
                <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={handleReport}>
                  Generate report
                </Button>
              }
            />
          )}

          <div>
            <Eyebrow className="mb-3 block">Proposed skill updates</Eyebrow>
            {c.skillUpdates.length === 0 ? (
              <p className="text-sm text-muted">
                No skill updates proposed yet. Generate a report and Aria will suggest refinements to its sourcing,
                outreach, and scoring skills.
              </p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                {c.skillUpdates.map((su) => (
                  <SkillUpdateCard key={su.id} skillUpdate={su} campaignId={c.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      </TabPanel>

      <CandidateDrawer candidate={selected} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
