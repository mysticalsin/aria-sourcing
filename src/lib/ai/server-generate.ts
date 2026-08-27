import "server-only";

/**
 * Server-side cloud LLM completion for autonomous loop cron routes.
 * Uses deployment env credentials (Fly secrets). Never called from the browser.
 */

import {
  buildCloudRequest,
  DEFAULT_MODEL,
  parseCloudResponse,
  PROVIDER_ENV,
  type AiProviderSlug,
} from "@/lib/ai/provider";

const PREFERRED: AiProviderSlug[] = ["kimi", "anthropic", "openai", "groq", "mistral", "xai", "deepseek"];

export type ServerGenerateResult = { ok: true; text: string; provider: AiProviderSlug } | { ok: false; reason: string };

function firstConfiguredProvider(): { slug: AiProviderSlug; key: string } | null {
  for (const slug of PREFERRED) {
    const key = process.env[PROVIDER_ENV[slug]] ?? "";
    if (key.trim()) return { slug, key: key.trim() };
  }
  return null;
}

export async function serverGenerateText(input: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<ServerGenerateResult> {
  const configured = firstConfiguredProvider();
  if (!configured) {
    return { ok: false, reason: "No cloud LLM API key configured on the server." };
  }
  const model = DEFAULT_MODEL[configured.slug];
  const { url, headers, body } = buildCloudRequest(
    configured.slug,
    model,
    input.system,
    input.prompt,
    configured.key,
    input.maxTokens ?? 2048,
  );
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return { ok: false, reason: `Upstream ${configured.slug} HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    const text = parseCloudResponse(configured.slug, json);
    if (!text?.trim()) return { ok: false, reason: "Empty model response." };
    return { ok: true, text: text.trim(), provider: configured.slug };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Model unreachable." };
  }
}
