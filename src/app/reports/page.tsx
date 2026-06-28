"use client";

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  Eyebrow,
  CardTitle,
  Field,
  Select,
  Button,
  Badge,
  EmptyState,
  SkeletonCard,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { WeeklyReportCard } from "@/components/reports/weekly-report-card";
import { SkillUpdateCard } from "@/components/reports/skill-update-card";
import {
  useHydrated,
  useCampaigns,
  useActiveCampaignId,
  useCampaign,
  useReportForCampaign,
  useActions,
} from "@/lib/store";
import { formatTimeAgo } from "@/lib/utils";
import {
  FileBarChart2,
  RefreshCw,
  Sparkles,
  Inbox,
  FileText,
} from "lucide-react";

export default function ReportsPage() {
  const hydrated = useHydrated();
  const campaigns = useCampaigns();
  const activeId = useActiveCampaignId();
  const actions = useActions();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = React.useState<string>("");
  const [generating, setGenerating] = React.useState(false);

  const effectiveId = selectedId || activeId || campaigns[0]?.id || "";
  const campaign = useCampaign(effectiveId);
  const report = useReportForCampaign(effectiveId);

  const skillUpdates = campaign?.skillUpdates ?? [];
  const proposedCount = skillUpdates.filter((s) => s.status === "proposed").length;

  function handleGenerate() {
    if (!effectiveId) return;
    setGenerating(true);
    const result = actions.generateReport(effectiveId);
    setGenerating(false);
    toast({
      title: result ? "Weekly report generated" : "Could not generate report",
      description: result
        ? `${result.campaignTitle} · ${result.skillUpdates.length} skill ${
            result.skillUpdates.length === 1 ? "update" : "updates"
          } proposed.`
        : "Pick a campaign that has sourced candidates first.",
      variant: result ? "success" : "warning",
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Intelligence"
        title="Weekly reports"
        description="Funnel economics, performance signals, and the self-improvement updates Aria proposes from every campaign it runs."
        actions={
          <Button
            variant="secondary"
            size="md"
            loading={generating}
            disabled={!effectiveId}
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={handleGenerate}
          >
            Generate report
          </Button>
        }
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <div className="space-y-6">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        }
      >
        {campaigns.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title="No campaigns to report on yet"
            description="Run an intake to spin up your first sourcing campaign, then generate a weekly report here."
            action={
              <Link
                href="/intake"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-paper shadow-soft transition-all hover:bg-ink/90 active:scale-[0.98]"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                New intake
              </Link>
            }
          />
        ) : (
          <div className="space-y-8">
            <Card>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <Field
                  label="Campaign"
                  htmlFor="report-campaign"
                  hint="Reports cover the trailing week of activity for the selected campaign."
                  className="w-full sm:max-w-md"
                >
                  <Select
                    id="report-campaign"
                    value={effectiveId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    options={campaigns.map((c) => ({
                      value: c.id,
                      label: `${c.title} · ${c.department}`,
                    }))}
                  />
                </Field>
                <div className="flex items-center gap-2 text-xs text-muted">
                  {report ? (
                    <Badge tone="aqua" size="sm" dot>
                      Generated {formatTimeAgo(report.generatedAt)}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" size="sm" dot>
                      No report yet
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {report ? (
              <WeeklyReportCard report={report} />
            ) : (
              <EmptyState
                icon={<FileBarChart2 className="h-7 w-7" />}
                title={`No report yet for ${campaign?.title ?? "this campaign"}`}
                description="Generate a weekly report to compute the funnel, performance economics, and proposed skill refinements."
                action={
                  <Button
                    variant="secondary"
                    size="md"
                    loading={generating}
                    leftIcon={<RefreshCw className="h-4 w-4" />}
                    onClick={handleGenerate}
                  >
                    Generate report
                  </Button>
                }
              />
            )}

            <section>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <Eyebrow>Self-improvement</Eyebrow>
                  <CardTitle>Skill updates</CardTitle>
                  <p className="mt-1 text-sm text-muted">
                    Aria proposes edits to its own playbooks from what worked this week. Accept to
                    bake them into future runs.
                  </p>
                </div>
                {proposedCount > 0 && (
                  <Badge tone="warning" dot>
                    {proposedCount} awaiting review
                  </Badge>
                )}
              </div>

              {skillUpdates.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-7 w-7" />}
                  title="No skill updates yet"
                  description="Generate a report to surface proposed refinements to the sourcing, outreach, scoring, and reply-classification skills."
                />
              ) : (
                <div className="grid gap-5 md:grid-cols-2">
                  {skillUpdates.map((s) => (
                    <SkillUpdateCard key={s.id} skillUpdate={s} campaignId={effectiveId} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </HydrationGate>
    </div>
  );
}
