/** Cloudflare Workers AI — OpenAI-compatible chat on account-scoped endpoints. */

export const CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const API_ROOT = "https://api.cloudflare.com/client/v4";

export function cloudflareWorkersAiChatUrl(accountId: string): string {
  const id = accountId.trim();
  return `${API_ROOT}/accounts/${encodeURIComponent(id)}/ai/v1/chat/completions`;
}

export function cloudflareWorkersAiModelsUrl(accountId: string): string {
  const id = accountId.trim();
  return `${API_ROOT}/accounts/${encodeURIComponent(id)}/ai/models/v1`;
}

export function isCloudflareAccountId(value: string): boolean {
  const v = value.trim();
  return /^[a-f0-9]{32}$/i.test(v);
}

export type CloudflareWorkersAiProbeResult =
  | { ok: true; detail: string; models: string[] }
  | { ok: false; detail: string };

/** Live probe: list models (preferred) or tiny chat completion. */
export async function probeCloudflareWorkersAi(
  accountId: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudflareWorkersAiProbeResult> {
  const id = accountId.trim();
  const token = apiToken.trim();
  if (!isCloudflareAccountId(id)) {
    return { ok: false, detail: "Cloudflare account id must be a 32-character hex string." };
  }
  if (token.length < 20) {
    return { ok: false, detail: "Cloudflare API token is too short." };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    const modelsRes = await fetchImpl(cloudflareWorkersAiModelsUrl(id), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (modelsRes.status === 401 || modelsRes.status === 403) {
      return { ok: false, detail: `Cloudflare rejected this token (HTTP ${modelsRes.status}).` };
    }
    if (modelsRes.ok) {
      const json = (await modelsRes.json().catch(() => null)) as {
        result?: Array<{ id?: string; name?: string }>;
      } | null;
      const models = (json?.result ?? [])
        .map((m) => (typeof m?.id === "string" ? m.id : typeof m?.name === "string" ? m.name : ""))
        .filter(Boolean)
        .slice(0, 200);
      return {
        ok: true,
        detail: `Cloudflare Workers AI accepted (HTTP ${modelsRes.status}, ${models.length} models).`,
        models,
      };
    }

    const chatRes = await fetchImpl(cloudflareWorkersAiChatUrl(id), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (chatRes.status === 401 || chatRes.status === 403) {
      return { ok: false, detail: `Cloudflare rejected this token (HTTP ${chatRes.status}).` };
    }
    if (chatRes.ok || chatRes.status === 400 || chatRes.status === 429) {
      return {
        ok: true,
        detail: `Cloudflare Workers AI authenticated (HTTP ${chatRes.status}).`,
        models: [CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL],
      };
    }
    const body = await chatRes.text().catch(() => "");
    const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      ok: false,
      detail: snippet
        ? `Cloudflare returned HTTP ${chatRes.status}: ${snippet}`
        : `Cloudflare returned HTTP ${chatRes.status}.`,
    };
  } catch {
    return { ok: false, detail: "Cloudflare Workers AI was unreachable." };
  }
}
