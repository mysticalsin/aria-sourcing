"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Eyebrow,
  EmptyState,
  SkeletonCard,
  Skeleton,
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
  commandCenterMode,
  resolveCommandCenterNextStep,
} from "@/lib/command-center-firstrun";
import {
  useActions,
  useActiveCampaign,
  useActivities,
  useCampaigns,
  useCandidates,
  useDashboardKpis,
  useHydrated,
  useIntegrations,
  usePendingApprovals,
  useReplies,
} from "@/lib/store";
import {
  emptyPeopleFirstShortlistError,
  missingPeoplePluginsToast,
  peoplePluginFailLoudUi,
} from "@/lib/sourcing/people-plugins";
import { funnelForCandidates } from "@/lib/metrics";
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
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full rounded-2xl" /> },
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
  const pendingApprovals = usePendingApprovals();
  const replies = useReplies();
  const activeCampaign = useActiveCampaign();
  const integrations = useIntegrations();
  const missingPeoplePlugins = activeCampaign
    ? missingPeoplePluginsToast(activeCampaign.jobAnalysis, integrations)
    : null;

  const unrepliedCount = React.useMemo(
    () => replies.filter((r) => !r.handled).length,
    [replies],
  );
  const nextStep = React.useMemo(
    () =>
      resolveCommandCenterNextStep({
        campaignCount: campaigns.length,
        activeCampaignTitle: activeCampaign?.title ?? null,
        pendingApprovalCount: pendingApprovals.length,
        unrepliedCount,
      }),
    [campaigns.length, activeCampaign?.title, pendingApprovals.length, unrepliedCount],
  );
  const ccMode = commandCenterMode({ campaignCount: campaigns.length });
  const isFirstRun = ccMode === "first_run";

  const activeCampaigns = campaigns.filter((c) => !["Filled", "Paused"].includes(c.status));
  const funnel = React.useMemo(() => funnelForCandidates(candidates), [candidates]);

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
    hint: string;
    icon: React.ReactNode;
    tone: Tone;
  }[] = [
    {
      label: "Active campaigns",
      value: kpis.activeCampaigns,
      hint: `${pluralize(kpis.totalCampaigns, "campaign")} created in total`,
      icon: <Megaphone aria-hidden />,
      tone: "tangerine",
    },
    {
      label: "Candidates sourced",
      value: formatNumber(kpis.candidatesSourced),
      hint: `${pluralize(kpis.contacted, "candidate")} contacted so far`,
      icon: <Users aria-hidden />,
      tone: "electric",
    },
    {
      label: "Reply rate",
      value: formatPercent(kpis.replyRate),
      hint: `Across ${pluralize(kpis.contacted, "contact")} reached`,
      icon: <Reply aria-hidden />,
      tone: "aqua",
    },
    {
      label: "Interviews booked",
      value: kpis.interviewsBooked,
      hint: `${pluralize(kpis.interested, "candidate")} interested in flight`,
      icon: <CalendarCheck aria-hidden />,
      tone: "violet",
    },
    {
      label: "Avg match score",
      value: kpis.avgMatchScore,
      hint: "Quality of the sourced pool",
      icon: <Target aria-hidden />,
      tone: scoreTone(kpis.avgMatchScore),
    },
    {
      label: "Time to first interview",
      value:
        kpis.timeToFirstInterviewHours != null ? `${kpis.timeToFirstInterviewHours}h` : "—",
      hint: "Mean across active campaigns",
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
    if (missingPeoplePlugins) {
      toast({
        title: "Connect LinkedIn and Apify",
        description: missingPeoplePlugins,
        variant: "error",
      });
      return;
    }
    const result = await actions.sourceNextBatch(activeCampaign.id);
    if (!result.ok) {
      const failLoud = peoplePluginFailLoudUi(
        result.error,
        activeCampaign.jobAnalysis,
        integrations,
      );
      toast({
        title: failLoud
          ? failLoud.title
          : result.source === "paused"
            ? "Campaign is paused"
            : "Sourcing failed",
        description: failLoud?.description ?? result.error,
        variant: "error",
      });
      return;
    }
    const emptyPeopleFirst = emptyPeopleFirstShortlistError(
      activeCampaign.jobAnalysis,
      integrations,
      result,
    );
    if (emptyPeopleFirst) {
      toast({
        title: "Connect LinkedIn and Apify",
        description: emptyPeopleFirst,
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
      <HeroPanel mode={ccMode} nextStep={nextStep} />

      <HydrationGate hydrated={hydrated} fallback={<DashboardFallback />}>
        {isFirstRun ? (
          <Card className="p-5 animate-fade-in" data-testid="cc-first-run-body">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Eyebrow>Your next step</Eyebrow>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Sparkles className="h-3.5 w-3.5 text-electric" aria-hidden />
                  {nextStep.reason}
                </p>
              </div>
              <Button
                variant="primary"
                leftIcon={<FilePlus2 aria-hidden />}
                onClick={() => router.push(nextStep.href)}
              >
                {nextStep.cta}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {/* Command bar — every action navigates or runs */}
            <Card className="p-5 animate-fade-in" data-testid="cc-returning-body">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <Eyebrow>Command center</Eyebrow>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <Sparkles className="h-3.5 w-3.5 text-electric" aria-hidden />
                    {nextStep.reason}
                  </p>
                  {missingPeoplePlugins ? (
                    <p
                      role="alert"
                      data-testid="cc-missing-plugin"
                      className="mt-2 text-sm font-semibold text-danger"
                    >
                      {missingPeoplePlugins}
                    </p>
                  ) : null}
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

            {runOpen && activeCampaign && (
              <AgentRunStream
                key={runToken}
                campaignId={activeCampaign.id}
                autoStart
                onClose={() => setRunOpen(false)}
                className="animate-fade-in"
              />
            )}

            {/* KPI grid */}
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {kpiCards.map((k) => (
                <MetricCard
                  key={k.label}
                  label={k.label}
                  value={k.value}
                  hint={k.hint}
                  icon={k.icon}
                  tone={k.tone}
                />
              ))}
            </section>

            <IntegrationStrip />

            {/* Main two-column layout */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Left: funnel + campaigns */}
              <div className="space-y-6 lg:col-span-2">
                <Card className="animate-fade-in">
                  <CardHeader>
                    <Eyebrow>Pipeline</Eyebrow>
                    <CardTitle className="mt-1">Conversion funnel</CardTitle>
                  </CardHeader>
                  <CardBody className="pt-0">
                    <FunnelChart data={funnel} height={300} />
                  </CardBody>
                </Card>

                <section>
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
                      description="Paste a job brief to open your next sourcing campaign."
                      action={
                        <Button
                          leftIcon={<FilePlus2 aria-hidden />}
                          onClick={() => router.push("/intake")}
                        >
                          Paste a job brief
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
                </section>
              </div>

              {/* Right: attention + TAnIA summary + activity */}
              <div className="space-y-6">
                <AttentionPanel />

                <TaniaSummary />

                <Card className="animate-fade-in">
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
              </div>
            </div>
          </>
        )}
      </HydrationGate>
    </div>
  );
}

function DashboardFallback() {
  return (
    <div className="space-y-8" aria-hidden>
      <Skeleton className="h-20 w-full rounded-3xl" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-3xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SkeletonCard />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
        <div className="space-y-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
