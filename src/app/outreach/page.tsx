"use client";

import * as React from "react";
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
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { OutreachMessageCard } from "@/components/outreach/outreach-message-card";
import { RateMeterPanel } from "@/components/outreach/rate-meter-panel";
import { QuickDraft } from "@/components/outreach/quick-draft";
import { WhatsAppTemplatePicker } from "@/components/outreach/whatsapp-template-picker";
import { SequenceLadder } from "@/components/outreach/sequence-ladder";
import { GlassBoxPanel } from "@/components/outreach/glass-box-panel";
import {
  useHydrated,
  useCampaigns,
  usePendingApprovals,
  useOutreach,
  useActiveCampaign,
  useSettings,
  useFollowUpsDue,
  useCandidate,
  useCandidates,
  useSeats,
  useIntegrations,
  useActions,
} from "@/lib/store";
import type { FollowUpDueItem } from "@/lib/recommendations";
import type { Candidate, OutreachMessage } from "@/lib/types";
import { recordedCandidateLawfulBasis } from "@/lib/candidate-lawful-basis";
import { effectiveDryRunMode, listConnectedMailboxes } from "@/lib/outreach-send-mode";
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

/** Compact "why this person" chip for a queue row — distinct per candidate
 *  since it's sourced from that candidate's own evidence/skills, never a
 *  shared template string. */
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

/** Small concurrent batches so drafting the whole due backlog (40+) never
 *  freezes the store or the UI -- mirrors handleBulkDraftOutreach's
 *  commit-loop pattern in candidates/page.tsx. draftFollowUpFor is itself
 *  async (it may attempt a live-gen round trip), so each batch runs its
 *  calls concurrently via Promise.all, then yields one tick before the next
 *  batch so the Progress meter actually paints. */
const FOLLOWUP_DRAFT_BATCH_SIZE = 5;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** One row in the "Follow-ups due" list (Task 1) — drafts a step-N follow-up
 *  straight into the approval queue above. Never sends. */
function FollowUpDueRow({ item }: { item: FollowUpDueItem }) {
  const candidate = useCandidate(item.candidateId);
  const actions = useActions();
  const { toast } = useToast();
  const [drafting, setDrafting] = React.useState(false);

  async function handleDraft() {
    setDrafting(true);
    const msg = await actions.draftFollowUpFor(item.candidateId);
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
  const pending = usePendingApprovals();
  const allOutreach = useOutreach();
  const activeCampaign = useActiveCampaign();
  const settings = useSettings();
  const seats = useSeats();
  const integrations = useIntegrations();
  const allCandidates = useCandidates();
  const followUpsDue = useFollowUpsDue();
  const actions = useActions();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const campaignParam = searchParams.get("campaign");

  const [campaignFilter, setCampaignFilter] = React.useState<string>(campaignParam ?? "all");
  const [sentOpen, setSentOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [approvingAll, setApprovingAll] = React.useState(false);
  const [recordingBasis, setRecordingBasis] = React.useState(false);
  const [draftingAllDue, setDraftingAllDue] = React.useState(false);
  const [draftAllProgress, setDraftAllProgress] = React.useState({ done: 0, total: 0 });
  // Which pending draft (if any) has its glass-box guardrail detail expanded.
  // Collapsed by default so the queue doesn't render every candidate's radar
  // + claim map at once; the panel is one click away for every draft.
  const [glassBoxId, setGlassBoxId] = React.useState<string | null>(null);

  const previewOnly = effectiveDryRunMode(settings.dryRunMode, seats, integrations);
  const connectedMailboxes = listConnectedMailboxes(seats, integrations);

  function toggleGlassBox(messageId: string) {
    setGlassBoxId((prev) => (prev === messageId ? null : messageId));
  }

  const matches = React.useCallback(
    (campaignId: string) => campaignFilter === "all" || campaignId === campaignFilter,
    [campaignFilter],
  );

  const pendingFiltered = pending.filter((m) => matches(m.campaignId));
  const pendingManualFiltered = allOutreach
    .filter((m) => m.status === "Pending Manual Send")
    .filter((m) => matches(m.campaignId));
  const scheduledFiltered = allOutreach
    .filter((m) => m.status === "Scheduled" || m.status === "Approved")
    .filter((m) => matches(m.campaignId));
  const followUpsDueFiltered = followUpsDue.filter((f) => matches(f.campaignId));

  const selectedInView = pendingFiltered.filter((m) => selectedIds.has(m.id));
  const allPendingSelected = pendingFiltered.length > 0 && selectedInView.length === pendingFiltered.length;

  const missingBasisCount = allCandidates.filter(
    (c) =>
      (campaignFilter === "all" ? true : c.campaignId === campaignFilter) &&
      !c.complianceFlags.anonymized &&
      !recordedCandidateLawfulBasis(c),
  ).length;

  function toggleSelect(messageId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allPendingSelected ? new Set() : new Set(pendingFiltered.map((m) => m.id)));
  }

  /** Bulk approve: routes every selected draft through the SAME gated
   *  approveOutreach() the single Approve button uses (it runs
   *  checkOutreachApproval internally) — never flips status directly, never
   *  bypasses a blocker, and never sends. Blocked drafts simply stay in the
   *  queue and get counted, matching the single-approve failure path. */
  async function handleBulkApprove() {
    if (approvingAll) return;
    const ids = selectedInView.map((m) => m.id);
    if (ids.length === 0) return;
    setApprovingAll(true);
    let approved = 0;
    let blocked = 0;
    let simulated = 0;
    const blockers = new Set<string>();
    const blockedIds = new Set<string>();
    try {
      for (const id of ids) {
        const res = await actions.approveOutreach(id);
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
      setSelectedIds(blockedIds);
      toast({
        title: simulated > 0
          ? `Approved ${approved}, simulated ${simulated}, blocked ${blocked}`
          : blocked > 0
            ? `Approved ${approved}, ${blocked} blocked`
            : `Approved ${approved}`,
        description:
          blocked > 0 || simulated > 0
            ? `Unchanged drafts stayed selected in the queue. ${Array.from(blockers).join(" ")}`
            : "Queued for send per the usual approval flow.",
        variant: blocked > 0 || simulated > 0 ? "warning" : "success",
      });
    } finally {
      setApprovingAll(false);
    }
  }

  function handleBulkLegitimateInterest() {
    if (recordingBasis) return;
    const targetCampaignId =
      campaignFilter !== "all"
        ? campaignFilter
        : activeCampaign?.id ?? pendingFiltered[0]?.campaignId ?? "";
    if (!targetCampaignId) {
      toast({
        title: "Pick a campaign",
        description: "Filter to one campaign (or set an active campaign) before recording bulk legitimate interest.",
        variant: "warning",
      });
      return;
    }
    setRecordingBasis(true);
    try {
      const res = actions.recordCampaignLawfulBasis(targetCampaignId, "legitimate_interest");
      if (!res.ok) {
        toast({ title: "Could not record lawful basis", description: res.error, variant: "error" });
        return;
      }
      toast({
        title:
          res.recorded > 0
            ? `Legitimate interest recorded for ${res.recorded}`
            : "No candidates needed a lawful basis",
        description:
          res.recorded > 0
            ? `${res.skipped} already recorded or skipped. Approve remains a separate click — nothing auto-sends.`
            : "Every candidate in this campaign already has a recorded basis, or none are eligible.",
        variant: "success",
      });
    } finally {
      setRecordingBasis(false);
    }
  }

  /** Draft-all-due autopilot (Task 2.4): clears the entire follow-up backlog
   *  in one click by calling the SAME draftFollowUpFor the single-row button
   *  uses for every currently-due item — never sends, only adds drafts to
   *  the approval queue above, each already tagged with its own sequence
   *  step. Batches with a small concurrency cap (see FOLLOWUP_DRAFT_BATCH_SIZE)
   *  so a large backlog (40+) never freezes the store or the UI. */
  async function handleDraftAllDue() {
    if (draftingAllDue) return;
    const items = followUpsDueFiltered;
    if (items.length === 0) return;

    setDraftingAllDue(true);
    setDraftAllProgress({ done: 0, total: items.length });
    let drafted = 0;
    for (let i = 0; i < items.length; i += FOLLOWUP_DRAFT_BATCH_SIZE) {
      const batch = items.slice(i, i + FOLLOWUP_DRAFT_BATCH_SIZE);
      const results = await Promise.all(batch.map((item) => actions.draftFollowUpFor(item.candidateId)));
      drafted += results.filter((msg) => msg !== null).length;
      setDraftAllProgress({ done: Math.min(i + FOLLOWUP_DRAFT_BATCH_SIZE, items.length), total: items.length });
      await nextTick();
    }
    setDraftingAllDue(false);

    const skipped = items.length - drafted;
    toast({
      title: `Drafted ${pluralize(drafted, "follow-up")}`,
      description:
        skipped > 0
          ? `${pluralize(skipped, "candidate")} skipped (already handled). Each draft carries its own sequence step, review above.`
          : "Each draft carries its own sequence step. Review and approve above; nothing was sent.",
      variant: drafted > 0 ? "success" : "warning",
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
        eyebrow="Outreach approvals"
        title="Human approval. Machine speed."
        description="Every message is drafted by the system and held here for your sign-off. Nothing reaches a candidate without your approval."
        actions={
          <div className="flex items-center gap-2">
            <label
              htmlFor="outreach-campaign-filter"
              className="text-sm font-semibold text-ink-soft"
            >
              Campaign
            </label>
            <Select
              id="outreach-campaign-filter"
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              options={campaignOptions}
              aria-label="Filter outreach by campaign"
              className="w-56"
            />
          </div>
        }
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <EmptyState
            title="Loading outreach…"
            description="Approval queue and drafts appear after workspace hydrate — no placeholder message cards."
          />
        }
      >
        <div className="space-y-6">
        <QuickDraft />
        <WhatsAppTemplatePicker />
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main queue */}
          <div className="space-y-6 lg:col-span-2">
            <section className="space-y-4">
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
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
                      onClick={handleBulkLegitimateInterest}
                      loading={recordingBasis}
                      disabled={recordingBasis || missingBasisCount === 0}
                    >
                      {missingBasisCount > 0
                        ? `Record legitimate interest (${missingBasisCount})`
                        : "Lawful basis ok"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<CheckCheck className="h-3.5 w-3.5" aria-hidden />}
                      onClick={handleBulkApprove}
                      loading={approvingAll}
                      disabled={selectedInView.length === 0 || approvingAll}
                    >
                      {approvingAll
                        ? "Recording approvals…"
                        : `Approve selected${selectedInView.length > 0 ? ` (${selectedInView.length})` : ""}`}
                    </Button>
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
                <div className="space-y-5">
                  {pendingFiltered.map((m) => (
                    <div key={m.id} className="space-y-2">
                      <WhyThisPersonChip message={m} />
                      <OutreachMessageCard
                        message={m}
                        selectable
                        selected={selectedIds.has(m.id)}
                        onToggleSelect={toggleSelect}
                      />
                      <button
                        type="button"
                        onClick={() => toggleGlassBox(m.id)}
                        aria-expanded={glassBoxId === m.id}
                        className="inline-flex items-center gap-1.5 rounded-full px-1 text-xs font-semibold text-electric transition hover:text-electric/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                        {glassBoxId === m.id ? "Hide guardrail detail" : "Show guardrail detail"}
                        <ChevronDown
                          className={cn("h-3.5 w-3.5 transition-transform", glassBoxId === m.id && "rotate-180")}
                          aria-hidden
                        />
                      </button>
                      {glassBoxId === m.id && <GlassBoxPanel message={m} />}
                    </div>
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
                onClick={() => setSentOpen((o) => !o)}
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
                    <span className="block text-sm font-bold text-ink">Approved / queued</span>
                    <span className="block text-xs text-muted">
                      Approved &amp; awaiting send (or scheduled)
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
                    Nothing approved yet. Approved messages awaiting send will appear here.
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
                    <Badge tone={previewOnly ? "electric" : "danger"} size="sm" dot>
                      {previewOnly ? "Dry-run / preview" : "Live"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted">
                    {connectedMailboxes.length === 0 ? (
                      <>
                        No mailbox connected —{" "}
                        <Link href="/settings?tab=integrations" className="font-semibold text-ink underline-offset-2 hover:underline">
                          open Integrations
                        </Link>
                      </>
                    ) : (
                      <>Connected: {connectedMailboxes.map((p) => p.label).join(", ")}</>
                    )}
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
                  {previewOnly
                    ? "Approve stays in dry-run / preview until a mailbox is connected (Outlook, Gmail, SendGrid, or Resend). LinkedIn alone never unlocks Live. GDPR holds still require a recorded lawful basis — then Approve again."
                    : "Approving queues the message for send. It goes live only when the seat is connected and its domain verified. Personalization and lawful basis are required before approval."}
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
        <EmptyState
          title="Loading outreach…"
          description="Approval queue and drafts appear after workspace hydrate — no placeholder message cards."
        />
      }
    >
      <OutreachView />
    </React.Suspense>
  );
}
