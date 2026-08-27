"use client";

import { ShieldCheck } from "lucide-react";
import { useMcpServers } from "@/lib/store";
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

export const LINKEDIN_OUTREACH_STACK_ID = "linkedin-outreach-stack";

function LinkedInOutreachStackInner() {
  const { signedIn } = useLinkedInConnections();
  const mcpServers = useMcpServers();
  const heyReach = findHeyReachMcpServer(mcpServers);
  const heyReachConnected = heyReachMcpConnected(heyReach);

  const stepsComplete = (signedIn ? 1 : 0) + (heyReachConnected ? 1 : 0);
  const progressPct = (stepsComplete / 2) * 100;

  let statusLabel = "Not started";
  let statusTone: "neutral" | "success" | "electric" = "neutral";
  if (heyReachConnected && signedIn) {
    statusLabel = "Identity + HeyReach MCP ready (LinkedIn send stays assisted-manual)";
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
      description="Two steps: prove who you are with LinkedIn OIDC, then wire HeyReach MCP so agents can use LinkedIn tools. Approve→Send on LinkedIn stays assisted-manual (409) — HeyReach does not auto-deliver from /api/outreach/send."
      statusLabel={statusLabel}
      statusTone={statusTone}
      progressPct={progressPct}
      progressLabel={`${stepsComplete} of 2 steps complete`}
      footer={
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          No scrape, no session bots, no password storage. OIDC tokens encrypted at rest.
          LinkedIn messaging drafts always require assisted-manual send (409); HeyReach is the MCP tools path for agents, not an auto-send bypass.
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
