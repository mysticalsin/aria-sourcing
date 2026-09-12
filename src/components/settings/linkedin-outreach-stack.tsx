"use client";

import { Bot, Hand, ShieldCheck } from "lucide-react";
import { useActions, useMcpServers, useSettings } from "@/lib/store";
import {
  findHeyReachMcpServer,
  heyReachMcpConnected,
} from "@/lib/heyreach-mcp";
import { ConnectionStackShell } from "@/components/settings/integration-connection-primitives";
import {
  LinkedInConnectionsProvider,
  LinkedInIdentityStep,
  useLinkedInConnections,
} from "@/components/settings/linkedin-connections-panel";
import { HeyReachOutreachStep } from "@/components/settings/heyreach-mcp-panel";
import { LinkedInCredentialsPanel } from "@/components/settings/linkedin-credentials-panel";
import { cn } from "@/lib/utils";
import type { LinkedInDeliveryMode } from "@/lib/types";

export const LINKEDIN_OUTREACH_STACK_ID = "linkedin-outreach-stack";

function DeliveryModeToggle() {
  const settings = useSettings();
  const actions = useActions();
  const mode: LinkedInDeliveryMode =
    settings.fleet?.deliveryMode === "manual" ? "manual" : "automatic";

  function setMode(next: LinkedInDeliveryMode) {
    actions.updateSettings({
      fleet: { ...settings.fleet, deliveryMode: next },
    });
  }

  return (
    <div className="py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Delivery mode</p>
      <p className="mt-1 text-sm text-ink">
        Leave Automatic for AriaBot VM sends. Switch to Manual only for paste-confirm workflows.
      </p>
      <div
        className="mt-4 grid gap-2 sm:grid-cols-2"
        role="radiogroup"
        aria-label="LinkedIn delivery mode"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "automatic"}
          onClick={() => setMode("automatic")}
          className={cn(
            "flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
            mode === "automatic"
              ? "border-electric/40 bg-electric/5 ring-2 ring-electric/20"
              : "border-line bg-surface hover:border-ink/20",
          )}
        >
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-electric" aria-hidden />
          <span>
            <span className="block text-sm font-semibold text-ink">Automatic outreach</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              Agents queue LinkedIn sends through an AriaBot Browser Computer sandbox/VM after
              approval — no paste/confirm per message.
            </span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "manual"}
          onClick={() => setMode("manual")}
          className={cn(
            "flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
            mode === "manual"
              ? "border-tangerine/40 bg-tangerine/5 ring-2 ring-tangerine/20"
              : "border-line bg-surface hover:border-ink/20",
          )}
        >
          <Hand className="mt-0.5 h-4 w-4 shrink-0 text-tangerine" aria-hidden />
          <span>
            <span className="block text-sm font-semibold text-ink">Manual approve-and-send</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              Draft → you copy/paste in LinkedIn → Confirm. Use when you want human-in-the-loop.
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function LinkedInOutreachStackInner() {
  const { seats, providers } = useLinkedInConnections();
  const settings = useSettings();
  const mcpServers = useMcpServers();
  const heyReach = findHeyReachMcpServer(mcpServers);
  const heyReachConnected = heyReachMcpConnected(heyReach);
  const deliveryMode: LinkedInDeliveryMode =
    settings.fleet?.deliveryMode === "manual" ? "manual" : "automatic";

  // Plug-and-play Ready = AriaBot supervisor + Browser Computer seat (not OIDC / HeyReach theater).
  const supervisorConfigured = Boolean(
    settings.computerSupervisorUrl?.trim() || providers?.browserComputerConfigured,
  );
  const browserSeats = seats.filter((s) => s.provider === "LinkedIn Browser Computer");
  const hasBrowserSeat = browserSeats.length > 0;
  const browserHealthy = browserSeats.some((s) => s.sessionHealthy === true);
  const browserBound = browserSeats.some((s) => Boolean(s.computerId?.trim()));

  const step1Done = supervisorConfigured;
  const step2Done =
    deliveryMode === "automatic" ? hasBrowserSeat && browserBound : heyReachConnected;
  const stepsComplete = (step1Done ? 1 : 0) + (step2Done ? 1 : 0);
  const progressPct = (stepsComplete / 2) * 100;

  let statusLabel = "Not started";
  let statusTone: "neutral" | "success" | "electric" = "neutral";
  if (deliveryMode === "automatic") {
    if (supervisorConfigured && hasBrowserSeat && browserHealthy) {
      statusLabel = "Ready · AriaBot session healthy";
      statusTone = "success";
    } else if (supervisorConfigured && hasBrowserSeat && browserBound) {
      statusLabel = "Seat ready — open LinkedIn login to finish session";
      statusTone = "electric";
    } else if (supervisorConfigured && hasBrowserSeat) {
      statusLabel = "Seat created — open LinkedIn login for agents";
      statusTone = "electric";
    } else if (supervisorConfigured) {
      statusLabel = "Supervisor set — create seat & log in";
      statusTone = "electric";
    } else if (hasBrowserSeat) {
      statusLabel = "Seat waiting — attach AriaBot supervisor URL";
      statusTone = "electric";
    } else if (heyReachConnected) {
      statusLabel = "HeyReach only (optional) — AriaBot path incomplete";
      statusTone = "electric";
    }
  } else if (heyReachConnected) {
    statusLabel = "Ready · manual HeyReach";
    statusTone = "success";
  } else {
    statusLabel = "Manual mode — connect HeyReach MCP";
    statusTone = "electric";
  }

  const identityState =
    !supervisorConfigured
      ? ("blocked" as const)
      : hasBrowserSeat && browserBound
        ? ("complete" as const)
        : ("active" as const);

  return (
    <ConnectionStackShell
      id={LINKEDIN_OUTREACH_STACK_ID}
      eyebrow="LinkedIn · plug and play"
      title="Connect AriaBot in 2 steps"
      description="1) Point Aria at the computer supervisor. 2) Open LinkedIn login for agents — sign in once inside the VM. Automatic sends reuse that session. OIDC, Vendor API, and HeyReach stay optional under Advanced."
      statusLabel={statusLabel}
      statusTone={statusTone}
      progressPct={progressPct}
      progressLabel={`${stepsComplete} of 2 steps complete`}
      footer={
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Aria never stores your LinkedIn password. Log in once via{" "}
          <span className="font-medium text-ink-soft">Open LinkedIn login for agents</span> — the VM
          keeps that session for Automatic sends after you Release control.
        </p>
      }
    >
      <LinkedInCredentialsPanel />
      <LinkedInIdentityStep stepState={identityState} hideAdvanced />
      <details className="border-b border-line/60 px-6 py-4 sm:px-8">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
          Advanced — delivery mode &amp; optional HeyReach
        </summary>
        <div className="mt-3 space-y-4">
          <DeliveryModeToggle />
          {deliveryMode === "manual" || heyReachConnected ? (
            <HeyReachOutreachStep
              stepState={heyReachConnected ? "complete" : "active"}
              identityComplete={hasBrowserSeat || heyReachConnected}
            />
          ) : (
            <details className="rounded-xl border border-line/70 bg-surface px-3 py-2 text-xs text-muted">
              <summary className="cursor-pointer font-medium text-ink-soft">
                Optional — HeyReach MCP (not required for AriaBot Automatic)
              </summary>
              <div className="mt-3">
                <HeyReachOutreachStep stepState="pending" identityComplete={hasBrowserSeat} />
              </div>
            </details>
          )}
        </div>
      </details>
    </ConnectionStackShell>
  );
}

export function LinkedInOutreachStack() {
  return (
    <LinkedInConnectionsProvider>
      <LinkedInOutreachStackInner />
    </LinkedInConnectionsProvider>
  );
}
