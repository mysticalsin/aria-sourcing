/**
 * Loop-task cloud failover for /api/hermes/chat.
 * When the selected provider key is missing/auth-dead/retryable, try
 * serverGenerateText (env keys first; optional workspace vault).
 * Chat/intake also tries the free Cloudflare Workers AI gateway when configured
 * (Fly Kimi may be 401-dead).
 */

import { serverGenerateText } from "@/lib/ai/server-generate";
import {
  cloudflareWorkersGatewayConfigured,
  generateViaCloudflareWorkersGateway,
} from "@/lib/ai/cloudflare-workers-gateway";

export const LOOP_LLM_TASKS = new Set(["outreach", "classify", "sourcing"]);

export async function tryLoopTaskCloudFailover(input: {
  task: string;
  system: string;
  prompt: string;
  /** Optional — env keys work without it; vault keys need a workspace. */
  workspaceId: string | null;
}): Promise<string | null> {
  if (input.task === "chat" && cloudflareWorkersGatewayConfigured()) {
    const gw = await generateViaCloudflareWorkersGateway({
      system: input.system,
      prompt: input.prompt,
      maxTokens: 2048,
    });
    if (gw.ok) return gw.text;
  }
  if (!LOOP_LLM_TASKS.has(input.task)) return null;
  const fallback = await serverGenerateText({
    system: input.system,
    prompt: input.prompt,
    maxTokens: 2048,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
  return fallback.ok ? fallback.text : null;
}
