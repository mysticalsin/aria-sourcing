import "server-only";

/**
 * Server-side cloud LLM completion for autonomous loop cron routes.
 * Uses deployment env credentials (Fly secrets). Never called from the browser.
 *
 * Provider selection: prefer first configured key in PREFERRED order. On auth
 * failures (401/403) try the next configured provider so a single expired key
 * (e.g. Kimi) cannot block intake when OpenAI/Anthropic is also set.
 * Fail closed only when every configured provider fails.
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

function configuredProviders(): Array<{ slug: AiProviderSlug; key: string }> {
  const out: Array<{ slug: AiProviderSlug; key: string }> = [];
  for (const slug of PREFERRED) {
    const key = process.env[PROVIDER_ENV[slug]] ?? "";
    if (key.trim()) out.push({ slug, key: key.trim() });
  }
  return out;
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

async function tryOneProvider(
  slug: AiProviderSlug,
  key: string,
  input: { system: string; prompt: string; maxTokens?: number },
): Promise<ServerGenerateResult | { ok: false; reason: string; authFailure: true }> {
  const model = DEFAULT_MODEL[slug];
  const { url, headers, body } = buildCloudRequest(
    slug,
    model,
    input.system,
    input.prompt,
    key,
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
      const reason = `Upstream ${slug} HTTP ${res.status}`;
      if (isAuthFailure(res.status)) return { ok: false, reason, authFailure: true };
      return { ok: false, reason };
    }
    const json = await res.json().catch(() => null);
    const text = parseCloudResponse(slug, json);
    if (!text?.trim()) return { ok: false, reason: "Empty model response." };
    return { ok: true, text: text.trim(), provider: slug };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Model unreachable." };
  }
}

export async function serverGenerateText(input: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<ServerGenerateResult> {
  const providers = configuredProviders();
  if (providers.length === 0) {
    return { ok: false, reason: "No cloud LLM API key configured on the server." };
  }

  const failures: string[] = [];
  for (const { slug, key } of providers) {
    const result = await tryOneProvider(slug, key, input);
    if (result.ok) return result;
    failures.push(result.reason);
    if ("authFailure" in result && result.authFailure) {
      continue; // try next configured provider
    }
    // Non-auth upstream errors fail closed on that attempt (do not cascade to a
    // weaker/cheaper model mid-parse) — only auth miss skips to the next key.
    return { ok: false, reason: result.reason };
  }
  return { ok: false, reason: failures.join("; ") || "All configured LLM providers failed." };
}
