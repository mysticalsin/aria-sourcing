import "server-only";

import {
  buildHermesSessionKey,
  buildHermesUpstreamPath,
  getHermesBaseUrl,
  hermesUpstreamHeaders,
  HERMES_PROXY_TIMEOUT_MS,
  resolveHermesProfilePrefix,
} from "@/lib/api/hermes-proxy";
import {
  hermesClassifySystemPrompt,
  hermesOutreachSystemPrompt,
  hermesSourcingSystemPrompt,
} from "@/lib/ai/hermes-recruiter-voice";
import { serverGenerateText } from "@/lib/ai/server-generate";

export type LoopLlmResult = { ok: true; text: string } | { ok: false; reason: string };

export type LoopLlmTask = "outreach" | "classify" | "sourcing";

const TASK_SYSTEM: Record<LoopLlmTask, string> = {
  outreach: hermesOutreachSystemPrompt(),
  classify: hermesClassifySystemPrompt(),
  sourcing: hermesSourcingSystemPrompt(),
};

function hermesLoopEnabled(): boolean {
  const key = (process.env.HERMES_API_KEY ?? "").trim();
  const url = (process.env.HERMES_API_URL ?? "").trim();
  if (!key || !url) return false;
  if (process.env.HERMES_LIVE_MODE === "0") return false;
  return true;
}

async function callHermesLoop(input: {
  task: LoopLlmTask;
  system: string;
  prompt: string;
  workspaceId: string;
  campaignId?: string;
  candidateId?: string;
  model?: string;
  maxTokens?: number;
}): Promise<LoopLlmResult | { ok: false; reason: string }> {
  const baseResult = getHermesBaseUrl("api");
  if (!baseResult.ok) return { ok: false, reason: baseResult.reason };

  const bearer = (process.env.HERMES_API_KEY ?? "").trim();
  if (!bearer) return { ok: false, reason: "Hermes API key not configured." };

  const profilePrefix = resolveHermesProfilePrefix(input.workspaceId);
  const sessionKey = buildHermesSessionKey({
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    candidateId: input.candidateId,
  });
  const path = buildHermesUpstreamPath("/v1/chat/completions", profilePrefix);
  const upstreamUrl = `${baseResult.baseUrl}${path}`;
  const model = input.model?.trim() || process.env.HERMES_LOOP_MODEL?.trim() || "hermes";

  try {
    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: hermesUpstreamHeaders({ bearerToken: bearer, sessionKey }),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        stream: false,
        max_tokens: input.maxTokens ?? 2048,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(HERMES_PROXY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, reason: `Hermes upstream HTTP ${res.status}` };
    }
    const json = (await res.json().catch(() => null)) as
      | { choices?: { message?: { content?: string } }[] }
      | null;
    const text = json?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false, reason: "Empty Hermes response." };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Hermes unreachable." };
  }
}

/**
 * Autonomous loop LLM router: prefer Hermes gateway when configured, else cloud vault path.
 * Never mock-success — callers fall back to deterministic templates on failure.
 */
export async function resolveLoopLlm(input: {
  task: LoopLlmTask;
  prompt: string;
  system?: string;
  workspaceId: string;
  campaignId?: string;
  candidateId?: string;
  maxTokens?: number;
}): Promise<LoopLlmResult> {
  const system = input.system ?? TASK_SYSTEM[input.task];

  if (hermesLoopEnabled()) {
    const hermes = await callHermesLoop({
      task: input.task,
      system,
      prompt: input.prompt,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      candidateId: input.candidateId,
      maxTokens: input.maxTokens,
    });
    if (hermes.ok) return hermes;
  }

  const cloud = await serverGenerateText({
    system,
    prompt: input.prompt,
    maxTokens: input.maxTokens,
    workspaceId: input.workspaceId,
  });
  if (cloud.ok) return { ok: true, text: cloud.text };
  return { ok: false, reason: cloud.reason };
}
