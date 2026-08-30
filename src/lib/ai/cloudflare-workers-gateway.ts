import "server-only";

/**
 * Fly → Cloudflare Worker gateway for free Workers AI (AI binding).
 *
 * Env (server-only):
 *   CLOUDFLARE_WORKERS_AI_URL     e.g. https://aria-intake-llm.<subdomain>.workers.dev
 *   CLOUDFLARE_WORKERS_AI_SECRET  shared bearer for the Worker
 *
 * Used when vault/Kimi env cannot serve live JD parse / chat.
 */

import { CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL } from "@/lib/integrations/cloudflare-workers-ai";

export function cloudflareWorkersGatewayConfigured(): boolean {
  const url = (process.env.CLOUDFLARE_WORKERS_AI_URL || "").trim();
  const secret = (process.env.CLOUDFLARE_WORKERS_AI_SECRET || "").trim();
  return Boolean(url && secret && /^https:\/\//i.test(url));
}

export async function generateViaCloudflareWorkersGateway(input: {
  system: string;
  prompt: string;
  maxTokens?: number;
  model?: string;
}): Promise<{ ok: true; text: string; model: string } | { ok: false; reason: string }> {
  const url = (process.env.CLOUDFLARE_WORKERS_AI_URL || "").trim().replace(/\/+$/, "");
  const secret = (process.env.CLOUDFLARE_WORKERS_AI_SECRET || "").trim();
  if (!url || !secret) {
    return { ok: false, reason: "Cloudflare Workers AI gateway is not configured." };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system: input.system,
        prompt: input.prompt,
        max_tokens: input.maxTokens ?? 2048,
        model: input.model || CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; text?: string; model?: string; reason?: string }
      | null;
    if (!res.ok || !json?.ok || typeof json.text !== "string" || !json.text.trim()) {
      return {
        ok: false,
        reason:
          (json && typeof json.reason === "string" && json.reason) ||
          `Cloudflare Workers AI gateway HTTP ${res.status}.`,
      };
    }
    return {
      ok: true,
      text: json.text,
      model: typeof json.model === "string" ? json.model : CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL,
    };
  } catch {
    return { ok: false, reason: "Cloudflare Workers AI gateway was unreachable." };
  }
}
