"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  Eyebrow,
  Badge,
  Button,
  Meter,
  Modal,
  Field,
  Input,
  Select,
  useToast,
} from "@/components/ui";
import { useActions, useSettings, useLlmProviders, useSavedModels, useTools, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
import {
  effectiveDailyCap,
  seatRemainingToday,
  warmupStage,
  seatHealthStatus,
  PROVIDER_LIMIT_NOTE,
} from "@/lib/fleet";
import type { AgentSeat, SeatProvider, ToolId } from "@/lib/types";
import { ROBOT_PALETTE } from "@/lib/floor3d";
import { cn, type Tone } from "@/lib/utils";
import { AgentPromptEditor } from "./agent-prompt-editor";
import {
  Mail,
  MailCheck,
  Pause,
  Play,
  Radio,
  FlaskConical,
  Pencil,
  ChevronDown,
  Clock,
  Flame,
  ShieldCheck,
  BrainCircuit,
  Palette,
} from "lucide-react";

const PROVIDER_TONE: Record<SeatProvider, Tone> = {
  "Microsoft Graph": "electric",
  "Gmail API": "tangerine",
  SendGrid: "aqua",
  Resend: "violet",
  "WhatsApp Cloud": "aqua",
  "Twilio SMS": "violet",
};

const STATUS_TONE: Record<AgentSeat["status"], Tone> = {
  active: "success",
  paused: "warning",
  disabled: "neutral",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function formatDays(days: number[]): string {
  if (days.length === 0) return "No days";
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 1) {
    return `${DAY_LABELS[sorted[0]]}–${DAY_LABELS[sorted[sorted.length - 1]]}`;
  }
  return sorted.map((d) => DAY_LABELS[d]).join(", ");
}

export function SeatCard({ seat }: { seat: AgentSeat }) {
  const actions = useActions();
  const settings = useSettings();
  const { toast } = useToast();

  // LLM assignment data
  const providers = useLlmProviders();
  const savedModels = useSavedModels();
  const tools = useTools();
  const role = useRole();
  const canManageLlm = can(role, "manage_fleet");

  const enabledProviders = providers.filter((p) => p.enabled);
  // When a provider is selected, filter models to that provider; else show all enabled.
  const enabledModels = savedModels.filter(
    (m) => m.enabled && (!seat.providerId || m.providerId === seat.providerId),
  );
  const enabledTools = tools.filter((t) => t.enabled);
  // If seat has an explicit toolIds override use it; else treat all workspace-enabled tools as active.
  const effectiveToolIds: ToolId[] = seat.toolIds ?? enabledTools.map((t) => t.id);

  function handleToggleTool(toolId: ToolId) {
    if (!canManageLlm) return;
    const current: ToolId[] = seat.toolIds ?? enabledTools.map((t) => t.id);
    const next = current.includes(toolId)
      ? current.filter((id) => id !== toolId)
      : [...current, toolId];
    actions.assignAgentTools(seat.id, next);
  }

  const [connectOpen, setConnectOpen] = React.useState(false);
  const [accountEmail, setAccountEmail] = React.useState(seat.connectedAccount || seat.operatorEmail);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [llmOpen, setLlmOpen] = React.useState(false);
  const [verifyingDomain, setVerifyingDomain] = React.useState(false);

  const cap = effectiveDailyCap(seat);
  const remaining = seatRemainingToday(seat);
  const stage = warmupStage(seat);
  const health = seatHealthStatus(seat, settings.fleet);
  const isLive = seat.mode === "live";
  const isPaused = seat.status === "paused";
  const isDisabled = seat.status === "disabled";
  const isOAuthProvider = seat.provider === "Gmail API" || seat.provider === "Microsoft Graph";

  const accountEmailId = React.useId();

  function handleToggleStatus() {
    const next = isPaused || isDisabled ? "active" : "paused";
    actions.setSeatStatus(seat.id, next);
    toast({
      title: next === "active" ? `${seat.name} resumed` : `${seat.name} paused`,
      description:
        next === "active"
          ? "Agent is back in the rotation, within its guardrails."
          : "Agent will not be assigned any new contacts until resumed.",
      variant: next === "active" ? "success" : "info",
    });
  }

  async function handleConnect() {
    const email = accountEmail.trim();
    if (!email || !email.includes("@")) {
      toast({ title: "Enter a valid mailbox", description: "Use the authorized sending address.", variant: "error" });
      return;
    }
    const result = await actions.connectSeatAccount(seat.id, email);
    if (!result.ok) {
      toast({ title: "Mailbox not connected", description: result.error, variant: "error" });
      return;
    }
    setConnectOpen(false);
    toast({
      title: "Mailbox connected",
      description: `${email} linked. Verify the domain before going live.`,
      variant: "success",
    });
  }

  function startOAuth() {
    if (!supabaseEnabled) {
      toast({
        title: "OAuth requires live mode",
        description: "Configure Supabase to connect a real mailbox. In demo mode, enter the email manually.",
        variant: "error",
      });
      return;
    }
    const path = seat.provider === "Gmail API" ? "/auth/google" : "/auth/microsoft";
    window.location.href = `${path}?seat_id=${encodeURIComponent(seat.id)}`;
  }

  async function handleDisconnect() {
    const res = await actions.disconnectSeatAccount(seat.id);
    if (!res.ok) {
      toast({ title: "Mailbox disconnect failed", description: res.error, variant: "error" });
      return;
    }
    if (res.dryRun) {
      toast({ title: "Public demo only", description: res.error, variant: "info" });
      return;
    }
    toast({ title: "Mailbox disconnected", variant: "info" });
  }

  async function handleToggleLive() {
    const result = await actions.toggleSeatLive(seat.id);
    toast({
      title: result.ok ? `${seat.name} updated` : "Cannot go live yet",
      description: result.reason,
      variant: result.ok ? (isLive ? "info" : "warning") : "error",
    });
  }

  async function handleVerifyDomain() {
    setVerifyingDomain(true);
    try {
      const result = await actions.verifySeatDomain(seat.id);
      if (!result.ok) {
        toast({ title: "Verification failed", description: result.error, variant: "error" });
        return;
      }
      if (result.verified) {
        toast({ title: "Domain verified", description: "SPF/DMARC/DKIM checks passed", variant: "success" });
      } else {
        toast({
          title: "Domain not verified",
          description: "DNS records missing, see the runbook",
          variant: "error",
        });
      }
    } finally {
      setVerifyingDomain(false);
    }
  }

  return (
    <>
      <Card className="flex h-full flex-col animate-fade-in">
        <CardContent className="flex flex-1 flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>{seat.provider}</Eyebrow>
              <h3 className="truncate text-base font-bold text-ink">{seat.name}</h3>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Badge tone={isLive ? "tangerine" : "aqua"} size="sm" dot>
                {isLive ? "Live" : "Dry-run"}
              </Badge>
              <Badge tone={STATUS_TONE[seat.status]} size="sm">
                {seat.status === "active" ? "Active" : seat.status === "paused" ? "Paused" : "Disabled"}
              </Badge>
            </div>
          </div>

          {/* Connected mailbox */}
          <div className="rounded-2xl bg-canvas px-3 py-2.5">
            <div className="flex items-center gap-2">
              {seat.connectedAccount ? (
                <MailCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : (
                <Mail className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {seat.connectedAccount || "Not connected"}
                </p>
                <p className="truncate text-xs text-muted">
                  {seat.connectedAccount
                    ? seat.domainVerified
                      ? "Domain verified (SPF/DKIM/DMARC)"
                      : "Domain not verified yet"
                    : "Connect an authorized mailbox to send"}
                </p>
              </div>
              <Badge tone={PROVIDER_TONE[seat.provider]} size="sm" className="ml-auto">
                {seat.provider}
              </Badge>
            </div>
            {seat.connectedAccount && !seat.domainVerified && canManageLlm && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                leftIcon={<ShieldCheck className="h-4 w-4" />}
                loading={verifyingDomain}
                onClick={handleVerifyDomain}
              >
                Verify domain
              </Button>
            )}
          </div>

          {/* Quota */}
          <Meter label="Sent today" used={seat.sentToday} limit={cap} />
          <p className="-mt-2 text-xs text-muted">
            {remaining} of today&apos;s {cap} remaining{" "}
            {isPaused || isDisabled ? "· paused, not sending" : ""}
          </p>

          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={health.tone} dot title={health.detail}>
              {health.shouldPause ? "Auto-paused" : health.label}
            </Badge>
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2.5 py-1 text-xs font-medium text-ink-soft">
              <Flame className="h-3.5 w-3.5 text-tangerine" aria-hidden />
              {stage.full ? "Fully warmed" : `Warm-up · day ${stage.day} · cap ${stage.cap}`}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2.5 py-1 text-xs font-medium text-ink-soft">
              <Clock className="h-3.5 w-3.5 text-electric" aria-hidden />
              {formatDays(seat.sendWindow.days)} {formatHour(seat.sendWindow.startHour)}–
              {formatHour(seat.sendWindow.endHour)} {seat.sendWindow.timezone}
            </span>
          </div>

          {health.shouldPause && (
            <p className="rounded-2xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
              {health.detail}
            </p>
          )}

          {/* Provider limit note */}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
            {PROVIDER_LIMIT_NOTE[seat.provider]} Official APIs only. No scraping, no LinkedIn
            automation.
          </p>

          {/* Controls */}
          <div className="mt-auto space-y-2 pt-1">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                leftIcon={isPaused || isDisabled ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                onClick={handleToggleStatus}
              >
                {isPaused || isDisabled ? "Resume" : "Pause"}
              </Button>
              <Button
                variant="subtle"
                size="sm"
                className="flex-1"
                leftIcon={<Mail className="h-4 w-4" />}
                onClick={() => setConnectOpen(true)}
              >
                {seat.connectedAccount ? "Mailbox" : "Connect"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant={isLive ? "subtle" : "secondary"}
                size="sm"
                className="flex-1"
                leftIcon={isLive ? <FlaskConical className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
                onClick={handleToggleLive}
              >
                {isLive ? "Switch to dry-run" : "Go live"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                leftIcon={<Pencil className="h-4 w-4" />}
                rightIcon={
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", editorOpen && "rotate-180")}
                  />
                }
                aria-expanded={editorOpen}
                onClick={() => setEditorOpen((v) => !v)}
              >
                Edit prompt
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              leftIcon={<BrainCircuit className="h-4 w-4" />}
              rightIcon={
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", llmOpen && "rotate-180")}
                />
              }
              aria-expanded={llmOpen}
              onClick={() => setLlmOpen((v) => !v)}
            >
              LLM config
            </Button>
          </div>

          {editorOpen && <AgentPromptEditor seat={seat} />}

          {llmOpen && (
            <div className="space-y-3 rounded-2xl bg-canvas p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                LLM assignment
              </p>

              <Field
                label="Provider"
                htmlFor={`llm-prov-${seat.id}`}
                hint="Overrides the workspace default for this agent."
              >
                <Select
                  id={`llm-prov-${seat.id}`}
                  value={seat.providerId ?? ""}
                  disabled={!canManageLlm}
                  onChange={(e) => {
                    actions.assignAgentProvider(seat.id, e.target.value);
                    // Clear model override when provider changes to avoid stale pairing.
                    if (seat.modelId) actions.assignAgentModel(seat.id, "");
                  }}
                  options={[
                    { value: "", label: "Workspace default" },
                    ...enabledProviders.map((p) => ({ value: p.id, label: p.label })),
                  ]}
                />
              </Field>

              <Field
                label="Model"
                htmlFor={`llm-model-${seat.id}`}
                hint={seat.providerId ? "Showing models for the selected provider." : "Select a provider to filter models."}
              >
                <Select
                  id={`llm-model-${seat.id}`}
                  value={seat.modelId ?? ""}
                  disabled={!canManageLlm}
                  onChange={(e) => actions.assignAgentModel(seat.id, e.target.value)}
                  options={[
                    { value: "", label: "Workspace default" },
                    ...enabledModels.map((m) => ({ value: m.id, label: m.label })),
                  ]}
                />
              </Field>

              <Field
                label="Floor colour"
                htmlFor={`color-${seat.id}`}
                hint="Robot colour on the 3D Ops Floor. Auto = palette by seat order."
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {ROBOT_PALETTE.map((c) => {
                    const active =
                      (seat.color ?? "").toLowerCase() === c.toLowerCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={!canManageLlm}
                        title={c}
                        aria-label={`Set colour ${c}`}
                        onClick={() => actions.updateSeat(seat.id, { color: c })}
                        className={cn(
                          "h-6 w-6 rounded-full border-2 transition hover:scale-110",
                          active ? "border-ink" : "border-transparent",
                          "disabled:cursor-default disabled:opacity-70",
                        )}
                        style={{ backgroundColor: c }}
                      />
                    );
                  })}
                  <label
                    className="relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-ink/30 transition hover:scale-110"
                    title="Custom colour"
                  >
                    <input
                      id={`color-${seat.id}`}
                      type="color"
                      value={seat.color ?? "#3B82F6"}
                      disabled={!canManageLlm}
                      onChange={(e) =>
                        actions.updateSeat(seat.id, { color: e.target.value })
                      }
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                    <Palette className="h-3.5 w-3.5 text-muted" aria-hidden />
                  </label>
                  {seat.color ? (
                    <button
                      type="button"
                      disabled={!canManageLlm}
                      onClick={() =>
                        actions.updateSeat(seat.id, { color: undefined })
                      }
                      className="ml-1 text-xs text-muted underline hover:text-ink disabled:opacity-70"
                    >
                      Reset to auto
                    </button>
                  ) : (
                    <span className="ml-1 text-xs text-muted">Auto</span>
                  )}
                </div>
              </Field>

              {enabledTools.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink-soft">Tools</p>
                  <div className="flex flex-wrap gap-1.5">
                    {enabledTools.map((tool) => {
                      const active = effectiveToolIds.includes(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          disabled={!canManageLlm}
                          onClick={() => handleToggleTool(tool.id)}
                          title={tool.description}
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition",
                            active
                              ? "bg-electric/10 text-electric"
                              : "bg-ink/[0.05] text-muted hover:bg-ink/[0.1]",
                            "disabled:cursor-default disabled:opacity-70",
                          )}
                        >
                          {tool.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    {seat.toolIds == null
                      ? "Using workspace defaults. Click to override."
                      : `${effectiveToolIds.length} of ${enabledTools.length} tools active`}
                  </p>
                </div>
              )}

              {!canManageLlm && (
                <p className="text-xs text-muted">
                  Admins only. Contact your workspace admin to change LLM assignments.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title={`Connect mailbox: ${seat.name}`}
        description="Official provider API only. No scraping, no synthetic identities."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConnectOpen(false)}>
              Close
            </Button>
            {seat.connectedAccount && (
              <Button variant="outline" size="sm" leftIcon={<Mail className="h-4 w-4" />} onClick={handleDisconnect}>
                Disconnect
              </Button>
            )}
            {!isOAuthProvider && (
              <Button variant="primary" size="sm" leftIcon={<MailCheck className="h-4 w-4" />} onClick={handleConnect}>
                Connect mailbox
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {seat.connectedAccount && (
            <div className="rounded-2xl bg-success-soft px-3.5 py-3 text-success">
              <p className="text-xs font-semibold">Connected account</p>
              <p className="text-sm font-medium">{seat.connectedAccount}</p>
            </div>
          )}

          {isOAuthProvider ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Connect the real mailbox via OAuth. Aria will send through the official {seat.provider} API.
              </p>
              <Button variant="primary" size="sm" className="w-full" onClick={startOAuth}>
                {seat.provider === "Gmail API" ? "Connect Google account" : "Connect Microsoft account"}
              </Button>
              {!supabaseEnabled && (
                <p className="text-xs text-muted">
                  OAuth flows require Supabase (live mode). In demo mode you can still record a mailbox address manually below.
                </p>
              )}
              <Field
                label="Mailbox address (demo/manual)"
                htmlFor={accountEmailId}
                hint="Used for display and dry-run. Real sends use the OAuth-connected account."
              >
                <Input
                  id={accountEmailId}
                  type="email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="recruiter@yourcompany.com"
                />
              </Field>
              <Button variant="outline" size="sm" className="w-full" onClick={handleConnect}>
                Save manual mailbox
              </Button>
            </div>
          ) : (
            <Field
              label="Authorized sending mailbox"
              htmlFor={accountEmailId}
              hint="The real mailbox this operator owns. API-key providers (SendGrid/Resend) use the configured account."
            >
              <Input
                id={accountEmailId}
                type="email"
                value={accountEmail}
                onChange={(e) => setAccountEmail(e.target.value)}
                placeholder="recruiter@yourcompany.com"
              />
            </Field>
          )}

          <div className="flex items-start gap-2 rounded-2xl bg-aqua-soft px-3.5 py-3 text-aqua">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="text-xs leading-relaxed">
              {PROVIDER_LIMIT_NOTE[seat.provider]} Sends stay within the account&apos;s published
              limits, warmed gradually, with global de-dupe so no one is contacted twice.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
