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
} from "@/lib/store";
import { can } from "@/lib/rbac";
import { SEAT_PROVIDERS, type SeatProvider, type AllocationResult } from "@/lib/types";
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
} from "lucide-react";

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
  const { toast } = useToast();
  const maxAgents = useSettings().fleet.maxAgents || 300;
  const canManage = can(useRole(), "manage_fleet");

  const [deployN, setDeployN] = React.useState("25");
  const handleDeploy = () => {
    if (!canManage) {
      toast({ title: "Admins only", description: "Only an admin can deploy agents.", variant: "warning" });
      return;
    }
    const n = Math.max(1, Math.min(Number(deployN) || 0, maxAgents));
    const res = actions.deployAgents(n);
    toast({
      title: res.created > 0 ? `Deployed ${res.created} agents` : "Fleet at capacity",
      description:
        res.created > 0
          ? `Fleet now ${res.total}/${res.max}. Each obeys official limits + shared guardrails.${res.capped ? " (capped at max)" : ""}`
          : `Already at the ${res.max}-agent ceiling.`,
      variant: res.created > 0 ? "success" : "warning",
    });
  };

  const [scopeId, setScopeId] = React.useState<string>("");
  const [allocation, setAllocation] = React.useState<AllocationResult | null>(null);
  const [sourcing, setSourcing] = React.useState(false);
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

  function handleRunSourcing() {
    setSourcing(true);
    const result = actions.runFleetSourcing({ campaignId });
    setSourcing(false);
    const lines = result.perSeat
      .filter((p) => p.sourced > 0)
      .map((p) => `${p.seatName}: +${p.sourced} (${p.campaignTitle})`);
    toast({
      title:
        result.sourced > 0
          ? `Sourced ${result.sourced} new candidate${result.sourced === 1 ? "" : "s"}`
          : "No new candidates this run",
      description:
        result.sourced > 0
          ? `${lines.join(" · ")}${result.skipped ? ` — ${result.skipped} skipped` : ""}`
          : "Every active agent is at capacity or this scope is exhausted. Add an agent or widen the campaign scope.",
      variant: result.sourced > 0 ? "success" : "warning",
    });
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
          ? `Allocated ${assigned} candidate${assigned === 1 ? "" : "s"} across the fleet`
          : "Nothing to allocate right now",
      description:
        assigned > 0
          ? `${result.fleetCapacityRemaining} sends of capacity remaining today${
              result.deferred.length ? ` · ${result.deferred.length} deferred` : ""
            }${result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}.`
          : "No ready candidates matched available, in-window agent capacity. Try running fleet sourcing first.",
      variant: assigned > 0 ? "success" : "info",
    });
  }

  function handleAddAgent() {
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
    const seat = actions.addSeat({
      name: trimmedName,
      operatorEmail: trimmedEmail,
      provider,
      dailyLimit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
    });
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
    { value: "", label: "All agents · fleet-wide" },
    ...campaigns.map((c) => ({ value: c.id, label: `${c.title} · ${c.department}` })),
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Agent fleet"
        title="An army of agents. One set of rules."
        description="Coordinated multi-agent sourcing and outreach that never double-contacts a candidate and stays inside every account's official API limits — no scraping, no LinkedIn automation."
        actions={
          <Button
            variant="secondary"
            size="md"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setAddOpen(true)}
          >
            Add agent
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
        <div className="space-y-8">
          {/* 1 — Fleet summary */}
          <FleetSummary />

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
                    Every agent runs under the same enforced rules. These are not suggestions — the
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
                  hint="Scopes both fleet sourcing and outreach allocation to one campaign, or the whole fleet."
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
                    Run fleet sourcing
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

              <p className="text-xs text-muted">
                Sourcing fans new candidates across active agents; allocation hands ready candidates
                to in-window seats with capacity left for{" "}
                <span className="font-semibold text-ink-soft">{scopeLabel}</span>. Both honour the
                global suppression ledger.
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
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-full border border-ink/12 bg-surface p-1 pl-3">
                  <label htmlFor="deploy-n" className="text-xs font-semibold text-muted">
                    Deploy
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
                    aria-label="Number of agents to deploy"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Bot className="h-4 w-4" />}
                    onClick={handleDeploy}
                    disabled={!canManage}
                    title={canManage ? undefined : "Admins only"}
                  >
                    Deploy agents
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => setAddOpen(true)}
                  disabled={!canManage}
                  title={canManage ? undefined : "Admins only"}
                >
                  Add one
                </Button>
              </div>
            </div>

            {seats.length === 0 ? (
              <EmptyState
                icon={<Bot className="h-7 w-7" />}
                title="No agents yet"
                description="Add your first agent to start coordinated, rule-bound sourcing and outreach across official mailboxes."
                action={
                  <Button
                    variant="secondary"
                    size="md"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={() => setAddOpen(true)}
                  >
                    Add agent
                  </Button>
                }
              />
            ) : (
              <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
                {seats.map((seat) => (
                  <SeatCard key={seat.id} seat={seat} />
                ))}
              </div>
            )}
          </section>

          {/* 5 — Suppression */}
          <SuppressionPanel />
        </div>
      </HydrationGate>

      {/* Add-agent modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add an agent"
        description="Each agent is one official mailbox under enforced limits. It starts in dry-run mode — connect a real account and verify the domain to go live."
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
              placeholder="e.g. Atlas — Backend Outreach"
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
            Official provider APIs only — no scraping, no LinkedIn automation. The new seat joins the
            shared suppression ledger immediately, so it can never re-contact someone another agent
            already reached.
          </p>
        </div>
      </Modal>
    </div>
  );
}
