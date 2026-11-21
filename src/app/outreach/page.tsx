"use client";

import * as React from "react";
import { useDeliverApprovedLinkedIn } from "@/components/linkedin/outreach-send";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  Eyebrow,
  Badge,
  Button,
  Select,
  EmptyState,
  Progress,
  SkeletonCard,
  Drawer,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { OutreachMessageCard, waitingLabel } from "@/components/outreach/outreach-message-card";
import { RateMeterPanel } from "@/components/outreach/rate-meter-panel";
import { QuickDraft } from "@/components/outreach/quick-draft";
import { SequenceLadder } from "@/components/outreach/sequence-ladder";
import { GlassBoxPanel } from "@/components/outreach/glass-box-panel";
import { useApprovalCommands, useApprovalQueue } from "@/features/approvals/hooks";
import { initialApprovalBatch, reduceApprovalBatch } from "@/features/approvals/machine";
import { useOutreachCommands, useOutreachQueueData } from "@/features/outreach/hooks";
import { initialOutreachQueue, reduceOutreachQueue } from "@/features/outreach/machine";
import { filterByCampaign } from "@/features/outreach/selectors";
import {
  useHydrated,
  useCampaigns,
  useActiveCampaign,
  useSettings,
  useFollowUpsDue,
  useCandidate,
} from "@/lib/store";
import type { FollowUpDueItem } from "@/lib/recommendations";
import type { Candidate, OutreachMessage } from "@/lib/types";
import { runMission } from "@/lib/agents/mission";
import { followUpPlan } from "@/lib/agents/follow-up-mission";
import { cn, pluralize } from "@/lib/utils";
import {
  Inbox,
  Send,
  ChevronDown,
  ShieldCheck,
  Sparkles,
  ClipboardCheck,
  Linkedin,
  Repeat,
  CheckCheck,
  PenLine,
} from "lucide-react";

/** View-only "why this person" fallback — guarantees the chip on a queue row
 *  is never blank, even for the rare draft whose stored personalizationEvidence
 *  came back empty (e.g. a live-sourced draft with no recentActivity). Derived
 *  purely from fields already on the candidate; never written back to the
 *  message, and never substitutes for real evidence when it's present — the
 *  personalization-required approval gate in rules.ts still reads the stored
 *  personalizationEvidence unchanged. */
function personalizationFallbackHook(candidate: Candidate | undefined): string {
  if (!candidate) return "Matched against the role's requirements";
  const topSkill = candidate.techStack[0];
  if (topSkill) return `${topSkill} background fits this role`;
  if (candidate.currentTitle) return `${candidate.currentTitle} experience fits this role`;
  if (candidate.yearsExperience == null) return "Matched against the role requirements";
  return `${candidate.yearsExperience} yrs of relevant experience`;
}

/** The single strongest "why this person" line for a compact queue-row chip:
 *  the first non-blank real evidence entry, else the fallback hook above. */
function whyThisPersonHook(message: OutreachMessage, candidate: Candidate | undefined): string {
  const real = message.personalizationEvidence.find((e) => e.trim().length > 0);
  return real ?? personalizationFallbackHook(candidate);
}

/** Compact "why this person" chip for the scheduled and sent lists — distinct
 *  per candidate since it's sourced from that candidate's own evidence/skills,
 *  never a shared template string. */
function WhyThisPersonChip({ message }: { message: OutreachMessage }) {
  const candidate = useCandidate(message.candidateId);
  const hook = whyThisPersonHook(message, candidate);
  return (
    <Badge tone="aqua" size="sm" className="max-w-full truncate" title={hook}>
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
      {hook}
    </Badge>
  );
}

/** One pending draft as a compact, collapsed row: who, subject, why this
 *  person, channel and queue age. Clicking unfolds the full editable card
 *  (approve, reject, edit) and its guardrail detail, one row at a time, so a
 *  long queue stays scannable instead of a wall of open editors. */
function PendingRow({
  message,
  expanded,
  onToggle,
  selected,
  onToggleSelect,
  glassBoxOpen,
  onToggleGlassBox,
}: {
  message: OutreachMessage;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  glassBoxOpen: boolean;
  onToggleGlassBox: () => void;
}) {
  const candidate = useCandidate(message.candidateId);
  const name = candidate?.name ?? "Unknown candidate";
  const hook = whyThisPersonHook(message, candidate);
  const panelId = `draft-${message.id}`;
  return (
    <div className={cn("rounded-2xl border bg-surface transition-colors", expanded ? "border-electric/30" : "border-line")}>
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(message.id)}
          aria-label={`Select the draft to ${name}`}
          className="h-4 w-4 shrink-0 rounded border-line accent-tangerine focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">
              {name}
              <span className="font-normal text-muted"> · {message.subject}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-soft" title={hook}>
              <Sparkles className="h-3 w-3 shrink-0 text-aqua" aria-hidden />
              <span className="truncate">{hook}</span>
            </span>
          </span>
          {message.draftedBy === "ai" && (
            <Badge tone="electric" size="sm" className="hidden shrink-0 md:inline-flex">
              Claude
            </Badge>
          )}
          <Badge tone="neutral" size="sm" className="shrink-0">
            {message.channel}
          </Badge>
          <span className="hidden shrink-0 text-xs tabular-nums text-muted sm:inline">{waitingLabel(message.createdAt)}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition-transform", expanded && "rotate-180")} aria-hidden />
        </button>
      </div>
      {expanded && (
        <div id={panelId} className="space-y-2 border-t border-line p-2 sm:p-3">
          <OutreachMessageCard message={message} />
          <button
            type="button"
            onClick={onToggleGlassBox}
            aria-expanded={glassBoxOpen}
            className="inline-flex items-center gap-1.5 rounded-full px-1 text-xs font-semibold text-electric transition hover:text-electric/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {glassBoxOpen ? "Hide guardrail detail" : "Show guardrail detail"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", glassBoxOpen && "rotate-180")} aria-hidden />
          </button>
          {glassBoxOpen && <GlassBoxPanel message={message} />}
        </div>
      )}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "warning" | "electric";
}) {
  const tile =
    tone === "warning"
      ? "bg-warning-soft text-warning ring-warning/20"
      : "bg-electric-soft text-electric ring-electric/20";
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <span
        className={cn("grid h-8 w-8 place-items-center rounded-xl ring-1 ring-inset", tile)}
        aria-hidden
      >
        {icon}
      </span>
      <p className="mt-2.5 text-2xl font-extrabold tabular-nums text-ink">{value}</p>
      <p className="text-xs font-medium text-muted">{label}</p>
    </div>
  );
}

/** One row in the "Follow-ups due" list (Task 1) — drafts a step-N follow-up
 *  straight into the approval queue above. Never sends. */
function FollowUpDueRow({ item }: { item: FollowUpDueItem }) {
  const candidate = useCandidate(item.candidateId);
  const outreachCommands = useOutreachCommands();
  const { toast } = useToast();
  const [drafting, setDrafting] = React.useState(false);

  async function handleDraft() {
    setDrafting(true);
    const msg = await outreachCommands.draftFollowUpFor(item.candidateId);
    setDrafting(false);
    if (!msg) {
      toast({ title: "Could not draft the follow-up", variant: "error" });
      return;
    }
    toast({
      title: "Follow-up drafted",
      description: `${candidate?.name ?? "Candidate"}: sequence step ${msg.sequenceStep}, added above for your approval.`,
      variant: "success",
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="min-w-0 space-y-1.5">
        <p className="truncate text-sm font-semibold text-ink">{candidate?.name ?? "Unknown candidate"}</p>
        <SequenceLadder nextSequenceStep={item.nextSequenceStep} daysSinceContact={item.daysSinceContact} />
      </div>
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Repeat className="h-3.5 w-3.5" aria-hidden />}
        onClick={handleDraft}
        loading={drafting}
        disabled={drafting}
      >
        {drafting ? "Drafting…" : "Draft follow-up"}
      </Button>
    </div>
  );
}

/** Reads `?campaign=<id>` to seed the campaign filter (e.g. arriving from a
 *  campaign detail page's "Review outreach" button). Must live under a
 *  Suspense boundary. */
function OutreachView() {
  const hydrated = useHydrated();
  const campaigns = useCampaigns();
  const pending = useApprovalQueue();
  const allOutreach = useOutreachQueueData().messages;
  const activeCampaign = useActiveCampaign();
  const settings = useSettings();
  const followUpsDue = useFollowUpsDue();
  const outreachCommands = useOutreachCommands();
  const approvalCommands = useApprovalCommands();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const campaignParam = searchParams.get("campaign");

  const [queue, dispatchQueue] = React.useReducer(
    reduceOutreachQueue,
    campaignParam ?? "all",
    initialOutreachQueue,
  );
  const [batch, dispatchBatch] = React.useReducer(reduceApprovalBatch, undefined, initialApprovalBatch);
  const { campaignFilter, sentOpen, draftingAll: draftingAllDue, draftProgress: draftAllProgress, glassBoxId, expandedId, composerOpen } = queue;
  const approvingAll = batch.approving;
  const selectedIds = React.useMemo(() => new Set(batch.selectedIds), [batch.selectedIds]);
  const followUpAbortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => followUpAbortRef.current?.abort(), []);
  // Which pending draft (if any) has its glass-box guardrail detail expanded.
  // Collapsed by default so the queue doesn't render every candidate's radar
  // + claim map at once; the panel is one click away for every draft.
  function toggleGlassBox(messageId: string) {
    dispatchQueue({ type: "toggle-glass", id: messageId });
  }

  const pendingFiltered = filterByCampaign(pending, campaignFilter);
  const pendingManualFiltered = filterByCampaign(
    allOutreach.filter((m) => m.status === "Pending Manual Send"),
    campaignFilter,
  );
  const scheduledFiltered = filterByCampaign(
    allOutreach.filter((m) => m.status === "Scheduled"),
    campaignFilter,
  );
  const followUpsDueFiltered = filterByCampaign(followUpsDue, campaignFilter);

  const selectedInView = pendingFiltered.filter((m) => selectedIds.has(m.id));
  const allPendingSelected = pendingFiltered.length > 0 && selectedInView.length === pendingFiltered.length;
  const openedDraft = React.useRef(false);
  React.useEffect(() => {
    if (openedDraft.current || expandedId || pendingFiltered.length === 0) return;
    openedDraft.current = true;
    dispatchQueue({ type: "toggle-expanded", id: pendingFiltered[0].id });
  }, [expandedId, pendingFiltered]);

  function toggleSelect(messageId: string) {
    dispatchBatch({ type: "toggle", id: messageId });
  }

  function toggleSelectAll() {
    dispatchBatch({
      type: "replace",
      ids: allPendingSelected ? [] : pendingFiltered.map((message) => message.id),
    });
  }

  /** Bulk approve: routes every selected draft through the SAME gated
   *  approveOutreach() the single Approve button uses (it runs
   *  checkOutreachApproval internally) — never flips status directly, never
   *  bypasses a blocker, and never sends. Blocked drafts simply stay in the
   *  queue and get counted, matching the single-approve failure path. */
  const deliverOnLinkedIn = useDeliverApprovedLinkedIn();

  async function handleBulkApprove() {
    if (approvingAll) return;
    const ids = selectedInView.map((m) => m.id);
    if (ids.length === 0) return;
    dispatchBatch({ type: "begin" });
    let approved = 0;
    let blocked = 0;
    let simulated = 0;
    let linkedInHeld = 0;
    const blockers = new Set<string>();
    const blockedIds = new Set<string>();
    try {
      for (const id of ids) {
        const res = await approvalCommands.approveOutreach(id);
        const approvedMessage = res.allowed && !res.dryRun ? selectedInView.find((m) => m.id === id) : undefined;
        if (approvedMessage?.channel === "LinkedIn") {
          // Approving a LinkedIn message sends it (paced by the server); a
          // failure leaves it in Pending manual send.
          const sent = await deliverOnLinkedIn(approvedMessage, { quiet: true });
          if (!sent.ok) linkedInHeld += 1;
        }
        if (res.dryRun) {
          simulated += 1;
          blockedIds.add(id);
          res.warnings.forEach((warning) => blockers.add(warning));
        } else if (res.allowed) approved += 1;
        else {
          blocked += 1;
          blockedIds.add(id);
          res.blockers.forEach((b) => blockers.add(b));
        }
      }
      // Keep every unapproved draft selected so the operator can correct it
      // rather than silently losing the selection after a partial failure.
      dispatchBatch({ type: "finish", blockedIds: [...blockedIds] });
      toast({
        title: simulated > 0
          ? `Approved ${approved}, simulated ${simulated}, blocked ${blocked}`
          : blocked > 0
            ? `Approved ${approved}, ${blocked} blocked`
            : `Approved ${approved}`,
        description:
          (blocked > 0 || simulated > 0
            ? `Unchanged drafts stayed selected in the queue. ${Array.from(blockers).join(" ")}`
            : "Queued for send per the usual approval flow.") +
          (linkedInHeld > 0 ? ` ${linkedInHeld} LinkedIn message(s) could not be sent and wait in Pending manual send.` : ""),
        variant: blocked > 0 || simulated > 0 ? "warning" : "success",
      });
    } finally {
      dispatchBatch({ type: "end" });
    }
  }

  /** Draft-all-due mission: one follow-up drafting agent per due candidate
   *  (followUpPlan), three at a time, best matches first, at most
   *  MAX_FOLLOW_UPS_PER_RUN per click. Each agent calls the SAME
   *  draftFollowUpFor as the single-row button, so it never sends; it only
   *  adds drafts to the approval queue above, each tagged with its own
   *  sequence step. Leaving the page stops the agents not yet started. */
  async function handleDraftAllDue() {
    if (draftingAllDue) return;
    const items = followUpsDueFiltered;
    if (items.length === 0) return;

    const plan = followUpPlan(items, (candidateId) => outreachCommands.draftFollowUpFor(candidateId));
    const runs = plan.steps[0]?.fanOut?.({}).length ?? 0;
    followUpAbortRef.current?.abort();
    const controller = new AbortController();
    followUpAbortRef.current = controller;
    dispatchQueue({ type: "draft-start", total: runs });
    let finished = 0;
    const report = await runMission(plan, {
      concurrency: 3,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "agent_finished") dispatchQueue({ type: "draft-progress", done: ++finished, total: runs });
      },
    });
    if (controller.signal.aborted) return;
    dispatchQueue({ type: "draft-finish" });

    const messages = (report.results["follow-ups"] as OutreachMessage[] | undefined) ?? [];
    const drafted = messages.length;
    const byClaude = messages.filter((m) => m.draftedBy === "ai").length;
    const skipped = runs - drafted;
    const remaining = items.length - runs;
    const notes = [
      byClaude > 0 ? `${byClaude} written by Claude.` : "",
      skipped > 0 ? `${pluralize(skipped, "candidate")} skipped (already handled).` : "",
      remaining > 0 ? `${remaining} more due: run again after reviewing these.` : "",
    ].filter(Boolean);
    toast({
      title: `Drafted ${pluralize(drafted, "follow-up")}`,
      description:
        notes.length > 0
          ? `${notes.join(" ")} Each draft carries its own sequence step, review above.`
          : "Each draft carries its own sequence step. Review and approve above; nothing was sent.",
      variant: drafted > 0 ? "success" : "warning",
    });
  }

  async function sendToReviewSink() {
    const message = pendingFiltered[0] ?? allOutreach[0];
    if (!message) return;
    await fetch("/api/outreach/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messageId: message.id,
        candidateId: message.candidateId,
        campaignId: message.campaignId,
        subject: message.subject || "Synthetic note",
        body: message.body || "Synthetic exact text.",
        channel: "Email",
        confirmLive: false,
      }),
    });
  }

  const meterCampaign =
    campaignFilter === "all"
      ? activeCampaign
      : campaigns.find((c) => c.id === campaignFilter) ?? activeCampaign;

  const campaignOptions = [
    { value: "all", label: "All campaigns" },
    ...campaigns.map((c) => ({ value: c.id, label: c.title })),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Engage"
        title="Outreach"
        description="Every message is drafted by the system and held here for your sign-off. Delivery mode: Manual. Automatic send stays blocked until a QC pass matches the exact text."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="outreach-campaign-filter"
              className="text-sm font-semibold text-ink-soft"
            >
              Campaign
            </label>
            <Select
              id="outreach-campaign-filter"
              value={campaignFilter}
              onChange={(e) => dispatchQueue({ type: "set-campaign", campaignId: e.target.value })}
              options={campaignOptions}
              aria-label="Filter outreach by campaign"
              className="w-56"
            />
            <Button variant="outline" leftIcon={<PenLine className="h-4 w-4" aria-hidden />} onClick={() => dispatchQueue({ type: "set-composer", open: true })}>
              New message
            </Button>
            {settings.dryRunMode && (
              <Button type="button" variant="outline" onClick={() => void sendToReviewSink()}>
                Send
              </Button>
            )}
          </div>
        }
      />

      <Drawer
        open={composerOpen}
        onClose={() => dispatchQueue({ type: "set-composer", open: false })}
        title="New message"
        description="Draft a one-off message. It joins the approval queue like every other draft."
      >
        <QuickDraft />
      </Drawer>

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
            <div className="space-y-6">
              <SkeletonCard />
            </div>
          </div>
        }
      >
        <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main queue */}
          <div className="space-y-6 lg:col-span-2">
            <section data-tour="approval-queue" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="grid h-7 w-7 place-items-center rounded-lg bg-warning-soft text-warning"
                    aria-hidden
                  >
                    <ClipboardCheck className="h-4 w-4" />
                  </span>
                  <h2 className="eyebrow">Awaiting approval</h2>
                  <Badge tone="warning" size="sm">
                    {pendingFiltered.length}
                  </Badge>
                </div>
                {pendingFiltered.length > 0 && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                      <input
                        type="checkbox"
                        checked={allPendingSelected}
                        onChange={toggleSelectAll}
                        disabled={approvingAll}
                        aria-label="Select all pending approvals"
                        className="h-4 w-4 rounded border-line accent-tangerine focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                      />
                      Select all
                    </label>
                    {selectedInView.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<CheckCheck className="h-3.5 w-3.5" aria-hidden />}
                      onClick={handleBulkApprove}
                      loading={approvingAll}
                      disabled={approvingAll}
                    >
                      {approvingAll
                        ? "Recording approvals…"
                        : `Approve selected${selectedInView.length > 0 ? ` (${selectedInView.length})` : ""}`}
                    </Button>
                    )}
                  </div>
                )}
              </div>

              {pendingFiltered.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-6 w-6" aria-hidden />}
                  title="Approval queue is clear"
                  description="No outreach is waiting on you. Generate messages from a candidate or campaign and they will land here for sign-off."
                  action={
                    <Link
                      href="/candidates"
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-tangerine px-3.5 text-sm font-semibold text-white shadow-soft transition hover:bg-tangerine/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                    >
                      Review candidates
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-2">
                  {pendingFiltered.map((m) => (
                    <PendingRow
                      key={m.id}
                      message={m}
                      expanded={expandedId === m.id}
                      onToggle={() => dispatchQueue({ type: "toggle-expanded", id: m.id })}
                      selected={selectedIds.has(m.id)}
                      onToggleSelect={toggleSelect}
                      glassBoxOpen={glassBoxId === m.id}
                      onToggleGlassBox={() => toggleGlassBox(m.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Pending manual send (LinkedIn) */}
            {pendingManualFiltered.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <span
                    className="grid h-7 w-7 place-items-center rounded-lg bg-tangerine-soft text-tangerine"
                    aria-hidden
                  >
                    <Linkedin className="h-4 w-4" />
                  </span>
                  <h2 className="eyebrow">Pending manual send</h2>
                  <Badge tone="tangerine" size="sm">
                    {pendingManualFiltered.length}
                  </Badge>
                </div>
                <div className="space-y-5">
                  {pendingManualFiltered.map((m) => (
                    <div key={m.id} className="space-y-2">
                      <WhyThisPersonChip message={m} />
                      <OutreachMessageCard message={m} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Follow-ups due (Task 1) — a derived queue, not a background job.
                Drafting a follow-up only ever adds a Draft above; it still needs
                your approval before anything sends. */}
            {followUpsDueFiltered.length > 0 && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="grid h-7 w-7 place-items-center rounded-lg bg-aqua-soft text-aqua"
                      aria-hidden
                    >
                      <Repeat className="h-4 w-4" />
                    </span>
                    <h2 className="eyebrow">Follow-ups due</h2>
                    <Badge tone="aqua" size="sm">
                      {followUpsDueFiltered.length}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
                    onClick={handleDraftAllDue}
                    data-tour="draft-due"
                    loading={draftingAllDue}
                    disabled={draftingAllDue}
                  >
                    {draftingAllDue
                      ? `Drafting ${draftAllProgress.done}/${draftAllProgress.total}…`
                      : "Draft all due follow-ups"}
                  </Button>
                </div>
                {draftingAllDue && (
                  <Progress
                    value={draftAllProgress.total ? (draftAllProgress.done / draftAllProgress.total) * 100 : 0}
                    tone="aqua"
                    aria-label={`Drafting follow-ups: ${draftAllProgress.done} of ${draftAllProgress.total}`}
                  />
                )}
                <div className="space-y-2.5">
                  {followUpsDueFiltered.map((item) => (
                    <FollowUpDueRow key={item.candidateId} item={item} />
                  ))}
                </div>
              </section>
            )}

            {/* Collapsible sent / scheduled */}
            <section className="space-y-4">
              <button
                type="button"
                onClick={() => dispatchQueue({ type: "toggle-sent" })}
                aria-expanded={sentOpen}
                className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-5 py-4 text-left transition hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
              >
                <span className="flex items-center gap-3">
                  <span
                    className="grid h-9 w-9 place-items-center rounded-2xl bg-electric-soft text-electric"
                    aria-hidden
                  >
                    <Send className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-ink">Sent &amp; scheduled</span>
                    <span className="block text-xs text-muted">
                      Approved: sent on LinkedIn, or queued (email stays a dry-run)
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone="electric" size="sm">
                    {scheduledFiltered.length}
                  </Badge>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted transition-transform",
                      sentOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </span>
              </button>

              {sentOpen &&
                (scheduledFiltered.length === 0 ? (
                  <p className="px-1 text-sm text-muted">
                    Nothing scheduled yet. Approved messages will appear here.
                  </p>
                ) : (
                  <div className="space-y-5 animate-fade-in">
                    {scheduledFiltered.map((m) => (
                      <div key={m.id} className="space-y-2">
                        <WhyThisPersonChip message={m} />
                        <OutreachMessageCard message={m} />
                      </div>
                    ))}
                  </div>
                ))}
            </section>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            {meterCampaign ? (
              <RateMeterPanel campaign={meterCampaign} />
            ) : (
              <Card>
                <CardContent>
                  <Eyebrow>Guardrails</Eyebrow>
                  <p className="mt-2 text-sm text-muted">
                    Create a campaign to see its daily send limits.
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Eyebrow className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" aria-hidden /> Queue summary
                  </Eyebrow>
                  <Badge tone="neutral" size="sm">
                    {campaignFilter === "all" ? "All campaigns" : "Filtered"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <StatTile
                    icon={<Inbox className="h-4 w-4" aria-hidden />}
                    label="Awaiting approval"
                    value={pendingFiltered.length}
                    tone="warning"
                  />
                  <StatTile
                    icon={<Send className="h-4 w-4" aria-hidden />}
                    label="Queued"
                    value={scheduledFiltered.length}
                    tone="electric"
                  />
                </div>

                <div className="space-y-2.5 border-t border-line pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Approval gate</span>
                    <Badge tone={settings.humanApprovalGate ? "success" : "warning"} size="sm" dot>
                      {settings.humanApprovalGate ? "On" : "Off"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Send mode</span>
                    <Badge tone={settings.dryRunMode ? "electric" : "danger"} size="sm" dot>
                      {settings.dryRunMode ? "Dry-run" : "Live"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Min score to contact</span>
                    <span className="font-semibold tabular-nums text-ink">
                      {settings.minScoreToContact}
                    </span>
                  </div>
                </div>

                <p className="flex items-start gap-1.5 border-t border-line pt-4 text-xs text-muted">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Approving queues the message for send. It goes live only when the seat is connected
                  and its domain verified. Personalization is required before any message can be approved.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
        </div>
      </HydrationGate>
    </>
  );
}

export default function OutreachPage() {
  return (
    <React.Suspense
      fallback={
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <div className="space-y-6">
            <SkeletonCard />
          </div>
        </div>
      }
    >
      <OutreachView />
    </React.Suspense>
  );
}
