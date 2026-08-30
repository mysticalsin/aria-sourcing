"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Eyebrow,
  EmptyState,
  useToast,
} from "@/components/ui";
import { HydrationGate } from "@/components/app/page-header";
import { HeroPanel } from "@/components/dashboard/hero-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { IntegrationStrip } from "@/components/dashboard/integration-strip";
import { TaniaSummary } from "@/components/dashboard/tania-summary";
import { CampaignCard } from "@/components/campaigns/campaign-card";
import { ActivityTimeline } from "@/components/shared/activity-timeline";
import { AgentRunStream } from "@/components/run/agent-run-stream";
import {
  useActions,
  useActiveCampaign,
  useActivities,
  useBookings,
  useCampaigns,
  useCandidates,
  useDashboardKpis,
  useHydrated,
  useOutreach,
  useReplies,
  useSettings,
  useWins,
} from "@/lib/store";
import { cumulativeSeries, fadeUp, staggerContainer } from "@/lib/dashboard-motion";
import { deriveExecDashboard } from "@/lib/exec-dashboard";
import { funnelForCandidates } from "@/lib/metrics";
import { supabaseEnabled } from "@/lib/supabase/config";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { formatNumber, formatPercent, pluralize, scoreTone, type Tone } from "@/lib/utils";
import {
  CalendarCheck,
  FilePlus2,
  FileText,
  GitBranch,
  Megaphone,
  PlayCircle,
  Radar,
  Reply,
  Sparkles,
  Target,
  Timer,
  Users,
} from "lucide-react";

const FunnelChart = dynamic(
  () => import("@/components/charts/funnel-chart").then((mod) => mod.FunnelChart),
  {
    ssr: false,
    loading: () => (
      <EmptyState
        title="Loading funnel chart…"
        description="Chart renders after client bundle load — no shimmer placeholder."
      />
    ),
  },
);

export default function DashboardPage() {
  const hydrated = useHydrated();
  const router = useRouter();
  const { toast } = useToast();
  const actions = useActions();

  const kpis = useDashboardKpis();
  const campaigns = useCampaigns();
  const candidates = useCandidates();
  const activities = useActivities();
  const outreach = useOutreach();
  const replies = useReplies();
  const bookings = useBookings();
  const settings = useSettings();
  const wins = useWins();
  const activeCampaign = useActiveCampaign();
  const reducedMotion = usePrefersReducedMotion();
  const demoMode = !supabaseEnabled || settings.dryRunMode;

  const activeCampaigns = campaigns.filter((c) => !["Filled", "Paused"].includes(c.status));
  const funnel = React.useMemo(() => funnelForCandidates(candidates), [candidates]);
  const trends = React.useMemo(
    () =>
      deriveExecDashboard(
        { campaigns, candidates, outreach, replies, bookings, activities, settings, wins },
        demoMode,
      ).trends,
    [campaigns, candidates, outreach, replies, bookings, activities, settings, wins, demoMode],
  );

  const sourcedSeries = React.useMemo(() => cumulativeSeries(trends.sourced), [trends.sourced]);
  const bookedSeries = React.useMemo(() => cumulativeSeries(trends.booked), [trends.booked]);
  const replyRateSeries = React.useMemo(() => {
    let contacted = 0;
    let replied = 0;
    return trends.contacted.map((c, i) => {
      contacted += c;
      replied += trends.replied[i] ?? 0;
      return contacted > 0 ? Math.round((replied / contacted) * 1000) / 10 : 0;
    });
  }, [trends.contacted, trends.replied]);
  const scoreSeries = React.useMemo(() => {
    const sorted = [...candidates]
      .filter((c) => c.matchScore > 0)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (sorted.length === 0) return [];
    const buckets = 8;
    const size = Math.max(1, Math.ceil(sorted.length / buckets));
    const out: number[] = [];
    for (let i = 0; i < sorted.length; i += size) {
      const slice = sorted.slice(i, i + size);
      out.push(Math.round(slice.reduce((s, c) => s + c.matchScore, 0) / slice.length));
    }
    return out;
  }, [candidates]);
  const campaignSeries = React.useMemo(() => {
    const sorted = [...campaigns].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return cumulativeSeries(sorted.map(() => 1));
  }, [campaigns]);

  // "Watch Aria Work" panel — remounted (via runToken as its key) on every
  // "Run Aria" click so each click starts a genuinely fresh, replayable run.
  const [runOpen, setRunOpen] = React.useState(false);
  const [runToken, setRunToken] = React.useState(0);

  function handleOpenRun() {
    if (!activeCampaign) {
      toast({
        title: "No active campaign",
        description: "Create a campaign from an intake brief first.",
        variant: "warning",
      });
      return;
    }
    setRunOpen(true);
    setRunToken((k) => k + 1);
  }

  const kpiCards: {
    label: string;
    value: string | number;
    secondaryLabel: string;
    icon: React.ReactNode;
    tone: Tone;
    series?: number[];
  }[] = [
    {
      label: "Active campaigns",
      value: kpis.activeCampaigns,
      secondaryLabel: `${pluralize(kpis.totalCampaigns, "campaign")} total`,
      icon: <Megaphone aria-hidden />,
      tone: "tangerine",
      series: campaignSeries,
    },
    {
      label: "Candidates sourced",
      value: formatNumber(kpis.candidatesSourced),
      secondaryLabel: "Total",
      icon: <Users aria-hidden />,
      tone: "electric",
      series: sourcedSeries,
    },
    {
      label: "Reply rate",
      value: formatPercent(kpis.replyRate),
      secondaryLabel: `${pluralize(kpis.contacted, "contact")} reached`,
      icon: <Reply aria-hidden />,
      tone: "aqua",
      series: replyRateSeries,
    },
    {
      label: "Interviews booked",
      value: kpis.interviewsBooked,
      secondaryLabel: `${pluralize(kpis.interested, "candidate")} interested`,
      icon: <CalendarCheck aria-hidden />,
      tone: "violet",
      series: bookedSeries,
    },
    {
      label: "Avg match score",
      value: kpis.avgMatchScore,
      secondaryLabel: "Avg",
      icon: <Target aria-hidden />,
      tone: scoreTone(kpis.avgMatchScore),
      series: scoreSeries,
    },
    {
      label: "Time to first interview",
      value:
        kpis.timeToFirstInterviewHours != null ? `${kpis.timeToFirstInterviewHours}h` : "—",
      secondaryLabel: "Mean across active",
      icon: <Timer aria-hidden />,
      tone: "neutral",
    },
  ];

  async function handleSourceBatch() {
    if (!activeCampaign) {
      toast({
        title: "No active campaign",
        description: "Create a campaign from an intake brief first.",
        variant: "warning",
      });
      return;
    }
    const result = await actions.sourceNextBatch(activeCampaign.id);
    if (!result.ok) {
      toast({
        title: result.source === "paused" ? "Campaign is paused" : "Sourcing failed",
        description: result.error,
        variant: "error",
      });
      return;
    }
    const isLive = result.source === "github" || result.source === "web";
    toast({
      title: `Sourced ${pluralize(result.accepted.length, "candidate")}${isLive ? " (live)" : ""}`,
      description: `${activeCampaign.title} · ${result.skipped.length} skipped by dedupe & exclusions.`,
      variant: result.accepted.length > 0 ? "success" : "info",
    });
  }

  function handleGenerateReport() {
    if (!activeCampaign) {
      toast({
        title: "No active campaign",
        description: "Create a campaign before generating a weekly report.",
        variant: "warning",
      });
      return;
    }
    const report = actions.generateReport(activeCampaign.id);
    toast({
      title: report ? "Weekly report generated" : "Could not generate report",
      description: report
        ? `${activeCampaign.title} · ${pluralize(report.skillUpdates.length, "skill update")} proposed.`
        : "The campaign could not be found.",
      variant: report ? "success" : "error",
    });
  }

  return (
    <div className="space-y-8">
      <HeroPanel />

      <HydrationGate hydrated={hydrated} fallback={<DashboardFallback />}>
        <motion.div
          className="space-y-8"
          variants={staggerContainer}
          initial={reducedMotion ? false : "hidden"}
          animate="show"
        >
          {/* Command bar — every action navigates or runs */}
          <motion.div variants={fadeUp}>
            <Card className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <Eyebrow>Command center</Eyebrow>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <Sparkles className="h-3.5 w-3.5 text-electric" aria-hidden />
                    {activeCampaign
                      ? `Acting on ${activeCampaign.title}`
                      : "No active campaign yet. Start with an intake."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button leftIcon={<FilePlus2 aria-hidden />} onClick={() => router.push("/intake")}>
                    New intake
                  </Button>
                  <Button
                    variant="secondary"
                    leftIcon={<Radar aria-hidden />}
                    onClick={handleSourceBatch}
                  >
                    Source next batch
                  </Button>
                  <Button
                    variant="primary"
                    leftIcon={<PlayCircle aria-hidden />}
                    onClick={handleOpenRun}
                  >
                    Run Aria
                  </Button>
                  <Button
                    variant="outline"
                    leftIcon={<GitBranch aria-hidden />}
                    onClick={() => router.push("/outreach")}
                  >
                    Review outreach
                  </Button>
                  <Button
                    variant="subtle"
                    leftIcon={<FileText aria-hidden />}
                    onClick={handleGenerateReport}
                  >
                    Generate weekly report
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>

          {runOpen && activeCampaign && (
            <AgentRunStream
              key={runToken}
              campaignId={activeCampaign.id}
              autoStart
              onClose={() => setRunOpen(false)}
              className="animate-fade-in"
            />
          )}

          {/* KPI grid — bklit-style metric tiles with motion.dev stagger */}
          <motion.section
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
            variants={staggerContainer}
          >
            {kpiCards.map((k) => (
              <MetricCard
                key={k.label}
                label={k.label}
                value={k.value}
                secondaryLabel={k.secondaryLabel}
                icon={k.icon}
                tone={k.tone}
                series={k.series}
              />
            ))}
          </motion.section>

          <motion.div variants={fadeUp}>
            <IntegrationStrip />
          </motion.div>

          {/* Main two-column layout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Left: funnel + campaigns */}
            <div className="space-y-6 lg:col-span-2">
              <motion.div variants={fadeUp}>
                <Card>
                  <CardHeader>
                    <Eyebrow>Pipeline</Eyebrow>
                    <CardTitle className="mt-1">Conversion funnel</CardTitle>
                  </CardHeader>
                  <CardBody className="pt-0">
                    <FunnelChart data={funnel} height={300} />
                  </CardBody>
                </Card>
              </motion.div>

              <motion.section variants={fadeUp}>
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <Eyebrow>In motion</Eyebrow>
                    <h2 className="display mt-1 text-2xl text-ink">Active campaigns</h2>
                  </div>
                  <Link
                    href="/campaigns"
                    className="text-sm font-semibold text-electric hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                  >
                    View all
                  </Link>
                </div>

                {activeCampaigns.length === 0 ? (
                  <EmptyState
                    icon={<Megaphone className="h-6 w-6" aria-hidden />}
                    title="No active campaigns"
                    description="Parse a hiring brief to spin up your first autonomous sourcing campaign."
                    action={
                      <Button
                        leftIcon={<FilePlus2 aria-hidden />}
                        onClick={() => router.push("/intake")}
                      >
                        New intake
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {activeCampaigns.map((campaign) => (
                      <CampaignCard key={campaign.id} campaign={campaign} />
                    ))}
                  </div>
                )}
              </motion.section>
            </div>

            {/* Right: attention + TAnIA summary + activity */}
            <motion.div className="space-y-6" variants={fadeUp}>
              <AttentionPanel />

              <TaniaSummary />

              <Card>
                <CardHeader>
                  <Eyebrow>Audit trail</Eyebrow>
                  <CardTitle className="mt-1">Recent activity</CardTitle>
                </CardHeader>
                <CardBody className="pt-0">
                  <ActivityTimeline
                    activities={activities}
                    limit={10}
                    emptyHint="Source candidates, draft outreach, or parse a brief to start the trail."
                  />
                </CardBody>
              </Card>
            </motion.div>
          </div>
        </motion.div>
      </HydrationGate>
    </div>
  );
}

function DashboardFallback() {
  return (
    <EmptyState
      title="Loading dashboard…"
      description="KPIs and campaign activity appear after workspace hydrate — no placeholder charts."
    />
  );
}
