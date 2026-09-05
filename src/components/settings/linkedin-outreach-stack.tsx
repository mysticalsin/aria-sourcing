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
    <div className="border-b border-line/60 px-6 py-5 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Delivery mode</p>
      <p className="mt-1 text-sm text-ink">
        Default is automatic outreach. Switch to manual when you want approve-and-paste.
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
              Agents queue LinkedIn sends through an OpenBot Browser Computer sandbox/VM after approval — no paste/confirm per message.
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
  const { signedIn } = useLinkedInConnections();
  const settings = useSettings();
  const mcpServers = useMcpServers();
  const heyReach = findHeyReachMcpServer(mcpServers);
  const heyReachConnected = heyReachMcpConnected(heyReach);
  const deliveryMode: LinkedInDeliveryMode =
    settings.fleet?.deliveryMode === "manual" ? "manual" : "automatic";

  const stepsComplete = (signedIn ? 1 : 0) + (heyReachConnected ? 1 : 0);
  const progressPct = (stepsComplete / 2) * 100;

  let statusLabel = "Not started";
  let statusTone: "neutral" | "success" | "electric" = "neutral";
  if (heyReachConnected && signedIn) {
    statusLabel = deliveryMode === "automatic" ? "Ready · automatic" : "Ready · manual";
    statusTone = "success";
  } else if (signedIn) {
    statusLabel = "Identity connected";
    statusTone = "electric";
  } else if (heyReachConnected) {
    statusLabel = "MCP connected";
    statusTone = "electric";
  }

  const identityState = signedIn ? "complete" : "active";
  const outreachState = heyReachConnected ? "complete" : signedIn ? "active" : "pending";

  return (
    <ConnectionStackShell
      id={LINKEDIN_OUTREACH_STACK_ID}
      eyebrow="LinkedIn stack"
      title="Identity & outreach"
      description="OpenBot Browser Computer is the Automatic path (sandbox/VM send). OIDC identity and Vendor API are optional. Optional HeyReach MCP. Delivery defaults to Automatic; Manual is an explicit toggle."
      statusLabel={statusLabel}
      statusTone={statusTone}
      progressPct={progressPct}
      progressLabel={`${stepsComplete} of 2 steps complete`}
      footer={
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          No scrape grey-market bots and no LinkedIn password storage in Aria. Login happens inside the OpenBot sandbox via Fleet Observe.
          {deliveryMode === "automatic"
            ? " Automatic mode queues OpenBot Browser Computer sends after approval (Postgres contact lease, DNC, and rate caps still apply)."
            : " Manual mode keeps assisted paste/confirm for each send."}
        </p>
      }
    >
      <DeliveryModeToggle />
      <LinkedInCredentialsPanel />
      <LinkedInIdentityStep stepState={identityState} />
      <HeyReachOutreachStep stepState={outreachState} identityComplete={signedIn} />
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
