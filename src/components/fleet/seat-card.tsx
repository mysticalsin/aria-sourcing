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
import type { AgentSeat, ToolId } from "@/lib/types";
import { ROBOT_PALETTE } from "@/lib/floor3d";
import {
  ConnectedIdentityBanner,
  StatusPill,
  SystemReadiness,
  type ReadinessItem,
} from "@/components/settings/integration-connection-primitives";
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
  ShieldCheck,
  BrainCircuit,
  Palette,
} from "lucide-react";

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
      toast({ title: "Mailbox label not saved", description: result.error, variant: "error" });
      return;
    }
    setConnectOpen(false);
    toast({
      title: "Operator mailbox label saved",
      description: `${email} recorded for display/dry-run only — not OAuth. Use Connect Microsoft/Google for live sends.`,
      variant: "info",
    });
  }

  async function startOAuth() {
    if (!supabaseEnabled) {
      toast({
        title: "OAuth requires live mode",
        description: "Configure Supabase to connect a real mailbox. In demo mode, enter the email manually.",
        variant: "error",
      });
      return;
    }
    const isGmail = seat.provider === "Gmail API";
    try {
      const res = await fetch("/api/email/connections", { credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as {
        providers?: { gmailOAuth?: boolean; microsoftOAuth?: boolean; encryptionReady?: boolean };
      } | null;
      const providers = json?.providers;
      const oauthOk = isGmail ? providers?.gmailOAuth === true : providers?.microsoftOAuth === true;
      if (!providers?.encryptionReady || !oauthOk) {
        toast({
          title: isGmail ? "Gmail OAuth not configured" : "Outlook OAuth not configured",
          description: !providers?.encryptionReady
            ? "Token encryption missing (DATA_ENCRYPTION_KEY). Connect stays disabled until secrets land."
            : "Microsoft/Google OAuth env missing on this deployment. Open Settings → Integrations after secrets land.",
          variant: "error",
        });
        return;
      }
    } catch {
      toast({
        title: "Could not verify OAuth readiness",
        description: "Retry from Settings → Integrations.",
        variant: "error",
      });
      return;
    }
    const path = isGmail ? "/auth/google" : "/auth/microsoft";
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

  const readinessItems: ReadinessItem[] = [
    {
      id: "mailbox",
      label: isOAuthProvider
        ? seat.mode === "live" && seat.connectedAccount
          ? "Mailbox connected (OAuth live)"
          : "Mailbox OAuth (mode=live)"
        : "Operator mailbox label",
      ok: isOAuthProvider
        ? seat.mode === "live" && Boolean(seat.connectedAccount)
        : Boolean(seat.connectedAccount),
      hint: isOAuthProvider
        ? "Connect via OAuth in Settings → Integrations (manual labels do not unlock Live)."
        : "API-key providers may record a sending address; verify domain before live.",
    },
    {
      id: "domain",
      label: "Domain verified (SPF/DKIM/DMARC)",
      ok: Boolean(seat.connectedAccount && seat.domainVerified),
      hint: "Run verify after DNS records propagate.",
    },
    {
      id: "live",
      label: "Live mode enabled",
      ok: isLive,
      optional: !seat.domainVerified,
    },
  ];

  const headerStatus =
    isLive && seat.domainVerified
      ? "Live · sending"
      : isLive
        ? "Live · domain pending"
        : seat.connectedAccount
          ? "Dry-run · connected"
          : "Dry-run · needs mailbox";

  const headerTone: Tone =
    health.shouldPause ? "danger" : isLive && seat.domainVerified ? "success" : seat.connectedAccount ? "electric" : "neutral";

  return (
    <>
      <Card className="flex h-full flex-col animate-fade-in">
        <CardContent className="flex flex-1 flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>{seat.provider}</Eyebrow>
              <h3 className="truncate text-base font-bold tracking-tight text-ink">{seat.name}</h3>
            </div>
            <StatusPill label={headerStatus} tone={headerTone} pulse={health.shouldPause} />
          </div>

          <SystemReadiness items={readinessItems} />

          {seat.connectedAccount ? (
            <ConnectedIdentityBanner
              displayName={seat.connectedAccount}
              secondary={
                seat.domainVerified
                  ? "Domain verified · ready for live sends"
                  : "Domain not verified — verify before going live"
              }
              icon={<MailCheck className="h-5 w-5" aria-hidden />}
              action={
                !seat.domainVerified && canManageLlm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<ShieldCheck className="h-4 w-4" />}
                    loading={verifyingDomain}
                    onClick={handleVerifyDomain}
                  >
                    Verify
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-line/80 bg-canvas/50 px-4 py-3">
              <p className="text-sm font-medium text-ink">No mailbox linked</p>
              <p className="mt-1 text-xs text-muted">Connect Gmail, Outlook, or another provider to send.</p>
            </div>
          )}

          {/* Quota + schedule */}
          <Meter label="Sent today" used={seat.sentToday} limit={cap} />
          <p className="-mt-2 text-xs text-muted">
            {remaining} remaining · {stage.full ? "Fully warmed" : `Warm-up day ${stage.day}`} ·{" "}
            {formatDays(seat.sendWindow.days)} {formatHour(seat.sendWindow.startHour)}–
            {formatHour(seat.sendWindow.endHour)}
            {isPaused || isDisabled ? " · paused" : ""}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[seat.status]} size="sm">
              {seat.status === "active" ? "Active" : seat.status === "paused" ? "Paused" : "Disabled"}
            </Badge>
            {health.shouldPause ? (
              <Badge tone={health.tone} dot size="sm">
                {health.label}
              </Badge>
            ) : null}
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
              Advanced · LLM & tools
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
            <div
              className={
                isOAuthProvider && seat.mode !== "live"
                  ? "rounded-2xl bg-warning-soft px-3.5 py-3 text-warning"
                  : "rounded-2xl bg-success-soft px-3.5 py-3 text-success"
              }
            >
              <p className="text-xs font-semibold">
                {isOAuthProvider && seat.mode !== "live"
                  ? "Operator mailbox label (not OAuth live)"
                  : "Connected account"}
              </p>
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
                hint="Operator label for display/dry-run only — does not complete Graph/Gmail OAuth or unlock Live send."
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
