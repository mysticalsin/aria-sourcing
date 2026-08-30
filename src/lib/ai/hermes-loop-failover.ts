/**
 * Loop-task cloud failover for /api/hermes/chat.
 * When the selected provider key is missing/auth-dead/retryable, try
 * serverGenerateText (env keys first; optional workspace vault).
 * Non-loop tasks (e.g. chat) never failover — keep template/mock paths.
 */

import { serverGenerateText } from "@/lib/ai/server-generate";

export const LOOP_LLM_TASKS = new Set(["outreach", "classify", "sourcing"]);

export async function tryLoopTaskCloudFailover(input: {
  task: string;
  system: string;
  prompt: string;
  /** Optional — env keys work without it; vault keys need a workspace. */
  workspaceId: string | null;
}): Promise<string | null> {
  if (!LOOP_LLM_TASKS.has(input.task)) return null;
  const fallback = await serverGenerateText({
    system: input.system,
    prompt: input.prompt,
    maxTokens: 2048,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
  return fallback.ok ? fallback.text : null;
}
