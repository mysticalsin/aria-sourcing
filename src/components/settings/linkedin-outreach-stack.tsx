"use client";

import { ShieldCheck } from "lucide-react";
import { useMcpServers, useSettings } from "@/lib/store";
import {
  findHeyReachMcpServer,
  heyReachMcpConnected,
} from "@/lib/heyreach-mcp";
import { heyReachSettingsReady } from "@/lib/heyreach-config";
import { ConnectionStackShell } from "@/components/settings/integration-connection-primitives";
import {
  LinkedInConnectionsProvider,
  LinkedInIdentityStep,
  useLinkedInConnections,
} from "@/components/settings/linkedin-connections-panel";
import { HeyReachOutreachStep } from "@/components/settings/heyreach-mcp-panel";

export const LINKEDIN_OUTREACH_STACK_ID = "linkedin-outreach-stack";

function LinkedInOutreachStackInner() {
  const { signedIn } = useLinkedInConnections();
  const mcpServers = useMcpServers();
  const heyReach = findHeyReachMcpServer(mcpServers);
  const heyReachConnected = heyReachMcpConnected(heyReach);
  const apiReady = heyReachSettingsReady(useSettings().heyreach);
  const step2Done = heyReachConnected || apiReady;

  const stepsComplete = (signedIn ? 1 : 0) + (step2Done ? 1 : 0);
  const progressPct = (stepsComplete / 2) * 100;

  let statusLabel = "Not started";
  let statusTone: "neutral" | "success" | "electric" = "neutral";
  if (step2Done && signedIn) {
    statusLabel = apiReady
      ? "Identity + HeyReach API ready"
      : "Identity + HeyReach MCP ready (add campaign id for send)";
    statusTone = "success";
  } else if (signedIn) {
    statusLabel = "Identity connected";
    statusTone = "electric";
  } else if (step2Done) {
    statusLabel = apiReady ? "API configured" : "MCP connected";
    statusTone = "electric";
  }

  const identityState = signedIn ? "complete" : "active";
  const outreachState = step2Done ? "complete" : signedIn ? "active" : "pending";

  return (
    <ConnectionStackShell
      id={LINKEDIN_OUTREACH_STACK_ID}
      eyebrow="LinkedIn stack"
      title="Identity & outreach"
      description="Two steps: prove who you are with LinkedIn OIDC, then add HeyReach API (key + campaign id) and/or MCP in Settings. With Autopilot ON, Aria queues LinkedIn first-touch via HeyReach after critics pass. Autopilot OFF keeps Approve → Send (or Pending Manual Send)."
      statusLabel={statusLabel}
      statusTone={statusTone}
      progressPct={progressPct}
      progressLabel={`${stepsComplete} of 2 steps complete`}
      footer={
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          No scrape, no session bots, no password storage. OIDC tokens encrypted at rest.
          Paste HeyReach API key + campaign id in step 2 — no Fly CLI required for delivery config.
        </p>
      }
    >
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
