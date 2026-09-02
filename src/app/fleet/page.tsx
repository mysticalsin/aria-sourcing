"use client";

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardTitle,
  Eyebrow,
  SectionNumeral,
  Button,
  Field,
  Select,
  Input,
  EmptyState,
  SkeletonCard,
  Modal,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { ConnectChannels } from "@/components/dashboard/connect-channels";
import { SeatCard } from "@/components/fleet/seat-card";
import { FleetSummary } from "@/components/fleet/fleet-summary";
import { SuppressionPanel } from "@/components/fleet/suppression-panel";
import { AllocationResultView } from "@/components/fleet/allocation-result";
import {
  useHydrated,
  useSeats,
  useCampaigns,
  useActiveCampaignId,
  useActions,
  useSettings,
  useRole,
  useApiKeys,
  useIntegrations,
} from "@/lib/store";
import { can } from "@/lib/rbac";
import {
  emptyPeopleFirstToast,
  isPeopleFirstRole,
  sourceRejectedToast,
} from "@/lib/sourcing/people-plugins";
import { supabaseEnabled } from "@/lib/supabase/config";
import { LINKEDIN_VENDOR_PROVIDER } from "@/lib/linkedin-channel";
import { SEAT_PROVIDERS, SEAT_STATUSES, type SeatProvider, type SeatStatus, type AllocationResult } from "@/lib/types";
import {
  Bot,
  Plus,
  Play,
  Send,
  ShieldCheck,
  Flame,
  Gauge,
  Clock,
  Network,
  CircleSlash,
  Search,
} from "lucide-react";

const SEAT_ROSTER_PAGE = 30;
const STATUS_LABEL: Record<SeatStatus, string> = {
  active: "Active",
  paused: "Paused",
  disabled: "Disabled",
};

const GUARDRAILS = [
  {
    icon: Flame,
    title: "Warm-up ramp",
    detail: "Every new mailbox starts low and climbs a fixed step per day until fully warmed.",
  },
  {
    icon: Gauge,
    title: "Per-account daily caps",
    detail: "Each seat respects its provider's official send limit. No bursting, no overrun.",
  },
  {
    icon: Clock,
    title: "Send windows",
    detail: "Messages only schedule inside each account's business-hours window and timezone.",
  },
  {
    icon: Network,
    title: "Global dedupe + suppression",
    detail: "One shared do-not-contact ledger. No candidate is ever contacted by two agents.",
  },
  {
    icon: CircleSlash,
    title: "Auto-pause on bounces",
    detail: "A seat that crosses the bounce or complaint threshold pauses itself automatically.",
  },
];

export default function FleetPage() {
  const hydrated = useHydrated();
  const seats = useSeats();
  const campaigns = useCampaigns();
  const activeId = useActiveCampaignId();
  const actions = useActions();
  const integrations = useIntegrations();
  const apiKeys = useApiKeys();
  const { toast } = useToast();
  const maxAgents = useSettings().fleet.maxAgents || 300;
  const role = useRole();
  const canManage = hydrated && can(role, "manage_fleet");

  const [deployN, setDeployN] = React.useState("25");

  // Roster filters — the "Deploy" control can push a fleet past 100+ seats,
  // so search/status/provider narrow it and a "load more" cursor keeps the
  // initial mount cheap instead of rendering every heavyweight SeatCard.
  const [rosterQuery, setRosterQuery] = React.useState("");
  const [rosterStatus, setRosterStatus] = React.useState<"all" | SeatStatus>("all");
  const [rosterProvider, setRosterProvider] = React.useState<"all" | SeatProvider>("all");
  const [rosterVisible, setRosterVisible] = React.useState(SEAT_ROSTER_PAGE);

  React.useEffect(() => {
    const connect = new URLSearchParams(window.location.search).get("connect");
    if (connect === "linkedin") setRosterProvider(LINKEDIN_VENDOR_PROVIDER);
    if (connect === "outlook") setRosterProvider("Microsoft Graph");
  }, []);

  const filteredSeats = React.useMemo(() => {
    const q = rosterQuery.trim().toLowerCase();
    return seats.filter((seat) => {
      if (rosterStatus !== "all" && seat.status !== rosterStatus) return false;
      if (rosterProvider !== "all" && seat.provider !== rosterProvider) return false;
      if (q && !seat.name.toLowerCase().includes(q) && !seat.operatorEmail.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [seats, rosterQuery, rosterStatus, rosterProvider]);

  React.useEffect(() => {
    setRosterVisible(SEAT_ROSTER_PAGE);
  }, [rosterQuery, rosterStatus, rosterProvider]);

  const visibleSeats = filteredSeats.slice(0, rosterVisible);
  const rosterHasMore = filteredSeats.length > visibleSeats.length;
  const handleDeploy = () => {
    if (!canManage) {
      toast({ title: "Admins only", description: "Only an admin can deploy agents.", variant: "warning" });
      return;
    }
    if (supabaseEnabled) {
      toast({
        title: "Verified accounts required",
        description: "Use Add one to bind each live agent to its real operator mailbox.",
        variant: "warning",
      });
      return;
    }
    const n = Math.max(1, Math.min(Number(deployN) || 0, maxAgents));
    const res = actions.deployAgents(n);
    toast({
      title: res.created > 0 ? `Generated ${res.created} demo agents` : "Demo fleet at capacity",
      description:
        res.created > 0
          ? `Synthetic demo fleet now ${res.total}/${res.max}. No mailbox or live sender was provisioned.${res.capped ? " (capped at max)" : ""}`
          : `Already at the ${res.max}-agent ceiling.`,
      variant: res.created > 0 ? "success" : "warning",
    });
  };

  const [scopeId, setScopeId] = React.useState<string>("");
  const [allocation, setAllocation] = React.useState<AllocationResult | null>(null);
  const [sourcing, setSourcing] = React.useState(false);
  const [sourceBatchError, setSourceBatchError] = React.useState<{
    title: string;
    description: string;
    href?: string;
    actionLabel?: string;
  } | null>(null);
  const [allocating, setAllocating] = React.useState(false);

  // Add-agent modal
  const [addOpen, setAddOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [operatorEmail, setOperatorEmail] = React.useState("");
  const [provider, setProvider] = React.useState<SeatProvider>("Microsoft Graph");
  const [dailyLimit, setDailyLimit] = React.useState("40");

  const nameId = React.useId();
  const emailId = React.useId();
  const providerId = React.useId();
  const limitId = React.useId();
  const scopeFieldId = React.useId();

  const campaignId = scopeId || undefined;
  const scopeLabel =
    campaigns.find((c) => c.id === scopeId)?.title ?? "the whole fleet";

  async function handleRunSourcing() {
    if (sourcing) return;
    if (!campaignId) {
      toast({
        title: "Select a campaign",
        description: "Select one reviewed campaign before sourcing.",
        variant: "warning",
      });
      return;
    }
    const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId);
    if (!selectedCampaign) {
      toast({
        title: "Campaign unavailable",
        description: "The selected campaign is no longer available. Choose another campaign.",
        variant: "error",
      });
      return;
    }
    setSourceBatchError(null);
    setSourcing(true);
    try {
      const result = await actions.sourceNextBatch(campaignId);
      if (!result.ok) {
        const failLoud = sourceRejectedToast(
          result.error,
          selectedCampaign.jobAnalysis,
          integrations,
          apiKeys,
        );
        setSourceBatchError(failLoud);
        toast({
          title: failLoud.title,
          description: failLoud.description,
          href: failLoud.href,
          actionLabel: failLoud.actionLabel,
          variant: "error",
        });
        return;
      }
      const emptyPeopleFirst = emptyPeopleFirstToast(
        selectedCampaign.jobAnalysis,
        integrations,
        result,
        apiKeys,
      );
      if (emptyPeopleFirst) {
        setSourceBatchError(emptyPeopleFirst);
        toast({
          title: emptyPeopleFirst.title,
          description: emptyPeopleFirst.description,
          href: emptyPeopleFirst.href,
          actionLabel: emptyPeopleFirst.actionLabel,
          variant: "error",
        });
        return;
      }
      if (result.accepted.length === 0 && isPeopleFirstRole(selectedCampaign.jobAnalysis)) {
        const failLoud = sourceRejectedToast(
          "Source next batch returned 0 people. This is not a successful harvest.",
          selectedCampaign.jobAnalysis,
          integrations,
          apiKeys,
        );
        setSourceBatchError(failLoud);
        toast({
          title: failLoud.title,
          description: failLoud.description,
          href: failLoud.href,
          actionLabel: failLoud.actionLabel,
          variant: "error",
        });
        return;
      }
      const sourced = result.accepted.length;
      const skipped = result.skipped.length;
      const demo = result.source === "mock";
      toast({
        title: sourced > 0
          ? `${demo ? "Generated" : "Sourced"} ${sourced} candidate${sourced === 1 ? "" : "s"}${demo ? " in demo mode" : ""}`
          : "No new candidates found",
        description: demo
          ? `${selectedCampaign.title} · ${skipped} excluded or already present. Demo candidates are synthetic and are not provider results.`
          : `${selectedCampaign.title} · ${skipped} excluded or already present. Results came through the reviewed provider sourcing path.`,
        variant: sourced > 0 ? "success" : "info",
      });
    } catch (error) {
      const thrown = error instanceof Error ? error.message : "Sourcing request failed";
      const failLoud = sourceRejectedToast(
        thrown,
        selectedCampaign.jobAnalysis,
        integrations,
        apiKeys,
      );
      setSourceBatchError(failLoud);
      toast({
        title: failLoud.title,
        description: failLoud.description,
        href: failLoud.href,
        actionLabel: failLoud.actionLabel,
        variant: "error",
      });
    } finally {
      setSourcing(false);
    }
  }

  function handleAllocate() {
    setAllocating(true);
    const result = actions.allocateOutreach({ campaignId });
    setAllocation(result);
    setAllocating(false);
    const assigned = result.assignments.length;
    toast({
      title:
        assigned > 0
          ? `Drafted ${assigned} outreach message${assigned === 1 ? "" : "s"} for approval`
          : "Nothing to allocate right now",
      description:
        assigned > 0
          ? `${assigned} candidate${assigned === 1 ? "" : "s"} across the fleet, each awaiting your approval before anything sends. ${result.fleetCapacityRemaining} of today's fleet capacity left${
              result.deferred.length ? ` · ${result.deferred.length} deferred` : ""
            }${result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}.`
          : "No ready candidates matched available, in-window agent capacity. Try running fleet sourcing first.",
      variant: assigned > 0 ? "success" : "info",
    });
  }

  async function handleAddAgent() {
    if (!canManage) {
      toast({ title: "Admins only", description: "Only an admin can add fleet agents.", variant: "warning" });
      return;
    }
    const trimmedName = name.trim();
    const trimmedEmail = operatorEmail.trim();
    if (!trimmedName || !trimmedEmail) {
      toast({
        title: "Name and operator email are required",
        description: "Give the agent a name and the mailbox owner's email to create the seat.",
        variant: "warning",
      });
      return;
    }
    const parsedLimit = Number.parseInt(dailyLimit, 10);
    const seat = await actions.addSeat({
      name: trimmedName,
      operatorEmail: trimmedEmail,
      provider,
      dailyLimit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
    });
    if (!seat) {
      toast({ title: "Agent not added", description: "Your profile cannot manage the fleet.", variant: "error" });
      return;
    }
    toast({
      title: `Agent “${seat.name}” added`,
      description: `${seat.provider} seat created in dry-run mode. Connect a mailbox and verify the domain before going live.`,
      variant: "success",
    });
    setName("");
    setOperatorEmail("");
    setProvider("Microsoft Graph");
    setDailyLimit("40");
    setAddOpen(false);
  }

  const campaignOptions = [
    { value: "", label: "All campaigns · allocation only" },
    ...campaigns.map((c) => ({ value: c.id, label: `${c.title} · ${c.department} · ${c.status}` })),
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Agent fleet"
        title="An army of agents. One set of rules."
        description="Coordinated multi-agent sourcing and outreach that never double-contacts a candidate and stays inside every account's official API limits. No scraping, no LinkedIn automation."
        actions={canManage ? (
          <Button
            variant="secondary"
            size="md"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setAddOpen(true)}
          >
            Add agent
          </Button>
        ) : undefined}
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
        <div className="space-y-8">
          {/* 1 — Fleet summary */}
          <FleetSummary />
          <ConnectChannels seats={seats} integrations={integrations} apiKeys={apiKeys} className="mt-0" />

          {/* 2 — Guardrail strip */}
          <Card>
            <CardContent>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-success-soft text-success">
                  <ShieldCheck className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <Eyebrow>Live guardrails</Eyebrow>
                  <CardTitle>Speed without the footguns</CardTitle>
                  <p className="mt-1 text-sm text-muted">
                    Every agent runs under the same enforced rules. These are not suggestions: the
                    fleet physically cannot step outside them.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {GUARDRAILS.map((g) => {
                  const Icon = g.icon;
                  return (
                    <div
                      key={g.title}
                      className="flex gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-electric-soft text-electric">
                        <Icon className="h-4.5 w-4.5" aria-hidden />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-ink">{g.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted">{g.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 3 — Action bar + allocation result */}
          <Card>
            <CardContent className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <Field
                  label="Scope"
                  htmlFor={scopeFieldId}
                  hint="Sourcing requires one selected, reviewed campaign. Allocation may use all campaigns."
                  className="w-full lg:max-w-md"
                >
                  <Select
                    id={scopeFieldId}
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    options={campaignOptions}
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="md"
                    loading={sourcing}
                    leftIcon={<Play className="h-4 w-4" />}
                    onClick={handleRunSourcing}
                  >
                    Source selected campaign
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={allocating}
                    leftIcon={<Send className="h-4 w-4" />}
                    onClick={handleAllocate}
                  >
                    Allocate outreach
                  </Button>
                </div>
              </div>

              {sourceBatchError ? (
                <div
                  role="alert"
                  data-testid="source-next-batch-error"
                  className="rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm"
                >
                  <p className="font-semibold text-ink">{sourceBatchError.title}</p>
                  <p className="mt-0.5 text-muted">{sourceBatchError.description}</p>
                </div>
              ) : null}

              <p className="text-xs text-muted">
                Sourcing runs the selected campaign through the canonical provider path; no local
                fleet generator is used. Allocation hands ready candidates to in-window seats with
                capacity left for <span className="font-semibold text-ink-soft">{scopeLabel}</span>
                {" "}and rechecks the shared suppression ledger before delivery.
              </p>

              <AllocationResultView result={allocation} />
            </CardContent>
          </Card>

          {/* 4 — Seats grid */}
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-start gap-3">
                <SectionNumeral n="04" />
                <div>
                  <Eyebrow>The roster</Eyebrow>
                  <CardTitle>Agents · {seats.length}/{maxAgents}</CardTitle>
                  <p className="mt-1 text-sm text-muted">
                    {seats.length} of up to {maxAgents} agents · each tied to one official mailbox,
                    warmed and rate-limited independently. Scale wide; the guardrails scale with you.
                  </p>
                </div>
              </div>
              {canManage && <div className="flex flex-wrap items-center gap-2">
                {!supabaseEnabled && <div className="flex items-center gap-1.5 rounded-full border border-ink/12 bg-surface p-1 pl-3">
                  <label htmlFor="deploy-n" className="text-xs font-semibold text-muted">
                    Demo agents
                  </label>
                  <Input
                    id="deploy-n"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxAgents}
                    value={deployN}
                    onChange={(e) => setDeployN(e.target.value)}
                    className="h-8 w-16 px-2 text-center"
                    aria-label="Number of demo agents to generate"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Bot className="h-4 w-4" />}
                    onClick={handleDeploy}
                  >
                    Generate demo agents
                  </Button>
                </div>}
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => setAddOpen(true)}
                >
                  Add one
                </Button>
              </div>}
            </div>

            {seats.length === 0 ? (
              <EmptyState
                icon={<Bot className="h-7 w-7" />}
                title="No agents yet"
                description="Add your first agent to start coordinated, rule-bound sourcing and outreach across official mailboxes."
                action={canManage ? (
                  <Button
                    variant="secondary"
                    size="md"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={() => setAddOpen(true)}
                  >
                    Add agent
                  </Button>
                ) : undefined}
              />
            ) : (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                  <Field label="Search" htmlFor="roster-search">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                        aria-hidden
                      />
                      <Input
                        id="roster-search"
                        className="pl-10"
                        placeholder="Name or mailbox"
                        value={rosterQuery}
                        onChange={(e) => setRosterQuery(e.target.value)}
                      />
                    </div>
                  </Field>
                  <Field label="Status" htmlFor="roster-status">
                    <Select
                      id="roster-status"
                      value={rosterStatus}
                      onChange={(e) => setRosterStatus(e.target.value as "all" | SeatStatus)}
                      options={[
                        { value: "all", label: "All statuses" },
                        ...SEAT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
                      ]}
                    />
                  </Field>
                  <Field label="Provider" htmlFor="roster-provider">
                    <Select
                      id="roster-provider"
                      value={rosterProvider}
                      onChange={(e) => setRosterProvider(e.target.value as "all" | SeatProvider)}
                      options={[
                        { value: "all", label: "All providers" },
                        ...SEAT_PROVIDERS.map((p) => ({ value: p, label: p })),
                      ]}
                    />
                  </Field>
                </div>

                {filteredSeats.length === 0 ? (
                  <EmptyState
                    icon={<Bot className="h-7 w-7" />}
                    title="No agents match your filters"
                    description="Try a different search term, or reset the status/provider filters."
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRosterQuery("");
                          setRosterStatus("all");
                          setRosterProvider("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <>
                    <p className="mb-3 text-xs text-muted">
                      Showing {visibleSeats.length} of {filteredSeats.length}
                      {filteredSeats.length !== seats.length ? ` (filtered from ${seats.length})` : ""}
                    </p>
                    <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
                      {visibleSeats.map((seat) => (
                        <SeatCard key={seat.id} seat={seat} />
                      ))}
                    </div>
                    {rosterHasMore && (
                      <div className="mt-5 flex justify-center">
                        <Button
                          variant="outline"
                          size="md"
                          onClick={() => setRosterVisible((v) => v + SEAT_ROSTER_PAGE)}
                        >
                          Load more ({filteredSeats.length - visibleSeats.length} remaining)
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>

          {/* 5 — Suppression */}
          <SuppressionPanel />
        </div>
      </HydrationGate>

      {/* Add-agent modal */}
      {canManage && <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add an agent"
        description="Each agent is one official mailbox under enforced limits. It starts in dry-run mode. Connect a real account and verify the domain to go live."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="md"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={handleAddAgent}
              disabled={!name.trim() || !operatorEmail.trim()}
            >
              Create agent
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Agent name" htmlFor={nameId} hint="A human-friendly label for this seat.">
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Atlas: Backend Outreach"
              autoComplete="off"
            />
          </Field>

          <Field
            label="Operator email"
            htmlFor={emailId}
            hint="The mailbox owner. The agent only ever sends from an account you connect."
          >
            <Input
              id={emailId}
              type="email"
              value={operatorEmail}
              onChange={(e) => setOperatorEmail(e.target.value)}
              placeholder="recruiter@company.com"
              autoComplete="off"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider" htmlFor={providerId}>
              <Select
                id={providerId}
                value={provider}
                onChange={(e) => setProvider(e.target.value as SeatProvider)}
                options={SEAT_PROVIDERS.map((p) => ({ value: p, label: p }))}
              />
            </Field>

            <Field
              label="Daily limit"
              htmlFor={limitId}
              hint="Hard ceiling. Warm-up may keep it lower at first."
            >
              <Input
                id={limitId}
                type="number"
                min="1"
                max="500"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
              />
            </Field>
          </div>

          <p className="rounded-2xl bg-canvas/60 p-3 text-xs leading-relaxed text-muted">
            Official provider APIs only. No scraping, no LinkedIn automation. The new seat joins the
            shared suppression ledger immediately, so it can never re-contact someone another agent
            already reached.
          </p>
        </div>
      </Modal>}
    </div>
  );
}
