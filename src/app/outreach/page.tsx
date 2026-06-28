"use client";

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  Eyebrow,
  Badge,
  Select,
  EmptyState,
  SkeletonCard,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { OutreachMessageCard } from "@/components/outreach/outreach-message-card";
import { RateMeterPanel } from "@/components/outreach/rate-meter-panel";
import { QuickDraft } from "@/components/outreach/quick-draft";
import {
  useHydrated,
  useCampaigns,
  usePendingApprovals,
  useOutreach,
  useActiveCampaign,
  useSettings,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  Inbox,
  Send,
  ChevronDown,
  ShieldCheck,
  Sparkles,
  ClipboardCheck,
  Linkedin,
} from "lucide-react";

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

export default function OutreachPage() {
  const hydrated = useHydrated();
  const campaigns = useCampaigns();
  const pending = usePendingApprovals();
  const allOutreach = useOutreach();
  const activeCampaign = useActiveCampaign();
  const settings = useSettings();

  const [campaignFilter, setCampaignFilter] = React.useState<string>("all");
  const [sentOpen, setSentOpen] = React.useState(false);

  const matches = React.useCallback(
    (campaignId: string) => campaignFilter === "all" || campaignId === campaignFilter,
    [campaignFilter],
  );

  const pendingFiltered = pending.filter((m) => matches(m.campaignId));
  const pendingManualFiltered = allOutreach
    .filter((m) => m.status === "Pending Manual Send")
    .filter((m) => matches(m.campaignId));
  const scheduledFiltered = allOutreach
    .filter((m) => m.status === "Scheduled")
    .filter((m) => matches(m.campaignId));

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
          <div className="grid gap-6 lg:grid-cols-3">
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
        <QuickDraft />
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main queue */}
          <div className="space-y-6 lg:col-span-2">
            <section className="space-y-4">
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
                    <OutreachMessageCard key={m.id} message={m} />
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
                    <OutreachMessageCard key={m.id} message={m} />
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
                    <span className="block text-sm font-bold text-ink">Scheduled</span>
                    <span className="block text-xs text-muted">
                      Approved &amp; queued for send
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
                      <OutreachMessageCard key={m.id} message={m} />
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
