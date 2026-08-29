"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Eyebrow,
  useConfirm,
  useToast,
} from "@/components/ui";
import { motion } from "framer-motion";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { StarBadge, SourceBadge } from "@/components/tania/badges";
import { useActions, useHydrated, useOutreach, useSettings, useVivier } from "@/lib/store";
import { staggerContainer } from "@/lib/dashboard-motion";
import { hasPendingDraft } from "@/lib/recommendations";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import {
  DEFAULT_STAR_THRESHOLDS,
  deriveLeadSource,
  deriveStarRating,
  starRatingScore,
} from "@/lib/tania";
import { LEAD_SOURCES, type Candidate, type LeadSource } from "@/lib/types";
import { cn, formatTimeAgo } from "@/lib/utils";
import {
  Clock,
  Dna,
  RotateCcw,
  Send,
  Sparkles,
  Trophy,
  UserMinus,
  Users,
} from "lucide-react";

type SourceFilter = LeadSource | "all";

/* ============================================================================
   #Vivier — TAnIA Talent Pool & Community Manager
   TopGuns & A-players not hired now but kept warm for the future. Silver
   Medalist tracker, warm re-contact pipeline, and a client-side DNA extractor.
   Every action is recruiter-initiated (Human Always Decides) — nothing sends.
   ========================================================================== */

export function VivierView() {
  const hydrated = useHydrated();
  const reducedMotion = usePrefersReducedMotion();
  const pool = useVivier();
  const outreach = useOutreach();
  const settings = useSettings();
  const actions = useActions();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [source, setSource] = React.useState<SourceFilter>("all");
  // Candidate ids with a re-contact draft currently in flight — disables the
  // button and blocks a double-click from firing draftRecontactFor twice
  // while the (potentially multi-second) live-LLM call is pending.
  const [draftingIds, setDraftingIds] = React.useState<Set<string>>(new Set());

  const thresholds = settings.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;

  const ratingOf = React.useCallback(
    (c: Candidate) => c.starRating ?? deriveStarRating(c.matchScore, thresholds),
    [thresholds],
  );

  const derived = React.useMemo(() => {
    const now = Date.now();
    const isDue = (c: Candidate) =>
      !c.recontactAt || new Date(c.recontactAt).getTime() <= now;

    const bySource: Record<LeadSource, number> = { Applicant: 0, Referral: 0, Outbound: 0 };
    for (const c of pool) bySource[deriveLeadSource(c)] += 1;

    const filtered = source === "all" ? pool : pool.filter((c) => deriveLeadSource(c) === source);

    // Dedupe against an already-queued re-contact draft, matching
    // deriveFollowUpsDue's hasPendingDraft guard for the outreach page.
    const silver = filtered.filter((c) => c.silverMedalist && !hasPendingDraft(outreach, c.id));
    const warm = [...filtered.filter((c) => isDue(c) && !hasPendingDraft(outreach, c.id))].sort(
      (a, b) => starRatingScore(ratingOf(b)) - starRatingScore(ratingOf(a)),
    );

    const dnaCounts = new Map<string, number>();
    for (const c of filtered)
      for (const skill of c.dna ?? []) dnaCounts.set(skill, (dnaCounts.get(skill) ?? 0) + 1);
    const dna = [...dnaCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

    return {
      now,
      bySource,
      filtered,
      silver,
      warm,
      dna,
      totalSilver: pool.filter((c) => c.silverMedalist).length,
      totalDue: pool.filter(isDue).length,
    };
  }, [pool, source, ratingOf, outreach]);

  /* ---- Actions (all recruiter-initiated) -------------------------------- */

  const handleRecontact = React.useCallback(
    async (c: Candidate) => {
      // Guard against a double-click firing draftRecontactFor twice for the
      // same candidate while the live-LLM call is still in flight.
      if (draftingIds.has(c.id)) return;
      setDraftingIds((prev) => new Set(prev).add(c.id));
      try {
        // Pooled candidates are Rejected/Not Interested, so use the #Vivier-specific
        // draft path (draftFollowUpFor is gated to the active follow-up sequence).
        const draft = await actions.draftRecontactFor(c.id);
        if (draft) {
          toast({
            title: "Re-contact draft queued for approval",
            description: `${c.name} · ${c.currentTitle}`,
            variant: "success",
          });
        } else {
          toast({
            title: "Could not draft a re-contact",
            description: `${c.name} is missing a linked campaign.`,
            variant: "warning",
          });
        }
      } finally {
        setDraftingIds((prev) => {
          const next = new Set(prev);
          next.delete(c.id);
          return next;
        });
      }
    },
    [actions, toast, draftingIds],
  );

  const handleRemove = React.useCallback(
    async (c: Candidate) => {
      const ok = await confirm({
        title: "Remove from #Vivier?",
        description: `${c.name} will leave the talent pool. You can re-add them from their profile at any time.`,
        confirmLabel: "Remove from pool",
        cancelLabel: "Keep",
        danger: true,
      });
      if (!ok) return;
      actions.toggleVivier(c.id);
      toast({
        title: "Removed from #Vivier",
        description: `${c.name} is no longer in the talent pool.`,
        variant: "success",
      });
    },
    [actions, confirm, toast],
  );

  /* ---- Render ----------------------------------------------------------- */

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Talent Pool"
        title="#Vivier"
        description="TopGuns and A-players not hired now, kept warm for the future: silver medalists, a re-contact pipeline, and the pool's aggregate DNA."
      />

      <HydrationGate hydrated={hydrated} fallback={<VivierFallback />}>
        {pool.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" aria-hidden />}
            title="The talent pool is empty"
            description="Pool a strong candidate who dropped out from their profile. Silver medalists and always-pooled referrals & outbound leads land here to be kept warm."
          />
        ) : (
          <div className="space-y-8">
            {/* KPI strip */}
            <motion.section
              className="grid grid-cols-2 gap-4 lg:grid-cols-4"
              aria-label="Talent pool overview"
              variants={staggerContainer}
              initial={reducedMotion ? false : "hidden"}
              animate="show"
            >
              <MetricCard
                label="In the pool"
                value={pool.length}
                hint="Profiles kept warm across all campaigns"
                icon={<Users aria-hidden />}
                tone="electric"
              />
              <MetricCard
                label="Silver Medalists"
                value={derived.totalSilver}
                hint="TopGun / A talent who dropped out"
                icon={<Trophy aria-hidden />}
                tone="warning"
              />
              <MetricCard
                label="Due for re-contact"
                value={derived.totalDue}
                hint="Re-contact date reached (or unscheduled)"
                icon={<Clock aria-hidden />}
                tone="tangerine"
              />
              <Card className="p-5 animate-fade-in">
                <div className="flex items-start justify-between gap-3">
                  <Eyebrow>By source</Eyebrow>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-violet-soft text-violet [&>svg]:h-[1.125rem] [&>svg]:w-[1.125rem]"
                    aria-hidden
                  >
                    <Dna />
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {LEAD_SOURCES.map((s) => (
                    <li key={s} className="flex items-center justify-between gap-2">
                      <SourceBadge source={s} size="sm" />
                      <span className="text-sm font-bold tabular-nums text-ink">
                        {derived.bySource[s]}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </motion.section>

            {/* Source filter chips */}
            <div
              role="group"
              aria-label="Filter the pool by lead source"
              className="flex flex-wrap items-center gap-2"
            >
              <FilterChip
                label="All"
                count={pool.length}
                active={source === "all"}
                onClick={() => setSource("all")}
              />
              {LEAD_SOURCES.map((s) => (
                <FilterChip
                  key={s}
                  label={s}
                  count={derived.bySource[s]}
                  active={source === s}
                  onClick={() => setSource(s)}
                />
              ))}
            </div>

            {/* Silver Medalist tracker */}
            <section aria-labelledby="vivier-silver">
              <div className="mb-4 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <Eyebrow>The gold we didn&apos;t lose</Eyebrow>
                  <h2
                    id="vivier-silver"
                    className="display mt-1 flex items-center gap-2 text-2xl text-ink"
                  >
                    <Trophy className="h-5 w-5 shrink-0 text-mantu-yellow" aria-hidden />
                    Silver Medalist tracker
                  </h2>
                </div>
                <span className="shrink-0 text-sm text-muted">
                  {derived.silver.length} tracked
                </span>
              </div>

              {derived.silver.length === 0 ? (
                <EmptyState
                  icon={<Trophy className="h-6 w-6" aria-hidden />}
                  title="No silver medalists here"
                  description="Strong TopGun / A candidates who dropped out will appear here to be kept warm for a future need."
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {derived.silver.map((c) => (
                    <SilverMedalistCard
                      key={c.id}
                      candidate={c}
                      rating={ratingOf(c)}
                      now={derived.now}
                      onRecontact={handleRecontact}
                      onRemove={handleRemove}
                      drafting={draftingIds.has(c.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Warm pipeline + DNA */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Warm re-contact pipeline */}
              <section className="lg:col-span-2" aria-labelledby="vivier-warm">
                <div className="mb-4">
                  <Eyebrow>Ready to re-engage</Eyebrow>
                  <h2
                    id="vivier-warm"
                    className="display mt-1 flex items-center gap-2 text-2xl text-ink"
                  >
                    <RotateCcw className="h-5 w-5 shrink-0 text-electric" aria-hidden />
                    Warm pipeline
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Pooled candidates whose re-contact date has arrived, highest star rating first.
                  </p>
                </div>

                {derived.warm.length === 0 ? (
                  <EmptyState
                    icon={<Clock className="h-6 w-6" aria-hidden />}
                    title="Nobody is due yet"
                    description="Everyone in this view is still inside their re-contact window. Check back when a date is reached."
                  />
                ) : (
                  <Card className="divide-y divide-line overflow-hidden">
                    {derived.warm.map((c) => (
                      <WarmRow
                        key={c.id}
                        candidate={c}
                        rating={ratingOf(c)}
                        now={derived.now}
                        onDraft={handleRecontact}
                        drafting={draftingIds.has(c.id)}
                      />
                    ))}
                  </Card>
                )}
              </section>

              {/* DNA extractor */}
              <section aria-labelledby="vivier-dna">
                <Card className="animate-fade-in">
                  <CardHeader>
                    <Eyebrow>DNA Extractor</Eyebrow>
                    <CardTitle className="mt-1 flex items-center gap-2">
                      <Dna className="h-5 w-5 shrink-0 text-violet" aria-hidden />
                      Pool DNA
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="pt-0">
                    {derived.dna.length === 0 ? (
                      <p className="text-sm text-muted">
                        No captured skills in this view yet.
                      </p>
                    ) : (
                      <>
                        <p className="mb-3 text-sm text-muted">
                          The most common skills &amp; signals across the pool. Chip size scales
                          with frequency.
                        </p>
                        <ul className="flex flex-wrap items-center gap-2">
                          {derived.dna.map(([skill, count]) => (
                            <li key={skill}>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full bg-violet/[0.06] font-semibold text-ink ring-1 ring-inset ring-violet/10",
                                  dnaChipSize(count, derived.dna[0][1]),
                                )}
                              >
                                {skill}
                                <span className="tabular-nums text-muted">{count}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </CardBody>
                </Card>
              </section>
            </div>
          </div>
        )}
      </HydrationGate>
    </div>
  );
}

/* ---- Sub-components ------------------------------------------------------- */

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric active:scale-[0.98]",
        active
          ? "bg-ink text-paper shadow-soft"
          : "bg-ink/[0.04] text-ink-soft hover:bg-ink/[0.08] hover:text-ink",
      )}
    >
      {label}
      <span
        className={cn(
          "min-w-5 rounded-full px-1.5 text-[0.6875rem] font-bold tabular-nums",
          active ? "bg-paper/20 text-paper" : "bg-ink/5 text-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function SilverMedalistCard({
  candidate: c,
  rating,
  now,
  onRecontact,
  onRemove,
  drafting,
}: {
  candidate: Candidate;
  rating: ReturnType<typeof deriveStarRating>;
  now: number;
  onRecontact: (c: Candidate) => void;
  onRemove: (c: Candidate) => void;
  drafting: boolean;
}) {
  return (
    <Card
      interactive
      className="flex flex-col gap-3 bg-mantu-yellow/[0.05] p-5 ring-1 ring-inset ring-mantu-yellow/40 animate-fade-in"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StarBadge rating={rating} size="sm" />
          <SourceBadge source={deriveLeadSource(c)} size="sm" />
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-mantu-yellow px-2 py-0.5 text-[0.6875rem] font-bold text-mantu-yellow-ink">
          <Trophy className="h-3 w-3" aria-hidden />
          Silver Medalist
        </span>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-ink">{c.name}</p>
        <p className="truncate text-xs text-muted">
          {c.currentTitle}
          {c.currentCompany ? ` · ${c.currentCompany}` : ""}
        </p>
      </div>

      <p className="text-xs leading-relaxed text-ink-soft">
        <span className="font-semibold">Why pooled: </span>
        {c.rejectionReason || "TopGun / A talent who dropped out, kept warm for a future need."}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted">
          <Clock className="h-3 w-3 shrink-0" aria-hidden />
          {c.recontactAt ? `Re-contact ${formatTimeAgo(c.recontactAt, now)}` : "Ready to re-contact"}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="subtle"
            leftIcon={<RotateCcw aria-hidden />}
            onClick={() => onRecontact(c)}
            loading={drafting}
            disabled={drafting}
          >
            {drafting ? "Drafting…" : "Re-contact"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<UserMinus aria-hidden />}
            onClick={() => onRemove(c)}
            aria-label={`Remove ${c.name} from the pool`}
          >
            Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}

function WarmRow({
  candidate: c,
  rating,
  now,
  onDraft,
  drafting,
}: {
  candidate: Candidate;
  rating: ReturnType<typeof deriveStarRating>;
  now: number;
  onDraft: (c: Candidate) => void;
  drafting: boolean;
}) {
  const overdue = c.recontactAt != null;
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-electric-soft text-xs font-bold text-electric"
        aria-hidden
      >
        {c.avatarInitials}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
        <p className="truncate text-xs text-muted">
          {c.currentTitle}
          {c.currentCompany ? ` · ${c.currentCompany}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StarBadge rating={rating} size="sm" />
        <SourceBadge source={deriveLeadSource(c)} size="sm" showLabel={false} />
      </div>

      {overdue ? (
        <Badge tone="tangerine" size="sm">
          Due {formatTimeAgo(c.recontactAt as string, now)}
        </Badge>
      ) : (
        <Badge tone="success" size="sm" dot>
          Ready now
        </Badge>
      )}

      <Button
        size="sm"
        variant="outline"
        leftIcon={<Send aria-hidden />}
        onClick={() => onDraft(c)}
        loading={drafting}
        disabled={drafting}
      >
        {drafting ? "Drafting…" : "Draft re-contact"}
      </Button>
    </div>
  );
}

function VivierFallback() {
  return (
    <EmptyState
      title="Loading vivier…"
      description="Talent pool metrics appear after workspace hydrate — no placeholder cards."
    />
  );
}

/** Discrete chip-size tiers so the DNA cloud scales with frequency but stays on-grid. */
function dnaChipSize(count: number, max: number): string {
  const ratio = max > 0 ? count / max : 0;
  if (ratio > 0.75) return "px-3.5 py-1.5 text-base";
  if (ratio > 0.5) return "px-3 py-1.5 text-sm";
  if (ratio > 0.25) return "px-3 py-1 text-sm";
  return "px-2.5 py-1 text-xs";
}
