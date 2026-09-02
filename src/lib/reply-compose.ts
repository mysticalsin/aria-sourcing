// Server-side reply composition shared by the inbound loops. The model call is
// isolated here so ingest modules stay testable with an injected composer.
// First server-configured provider wins; browser-supplied model keys never
// reach a candidate-facing reply.

import { buildReplyPrompt } from "@/lib/autopilot";
import {
  CLOUD_ENDPOINT,
  DEFAULT_MODEL,
  PROVIDER_ENV,
  buildCloudRequest,
  parseCloudResponse,
  type AiProviderSlug,
} from "@/lib/ai/provider";

export interface ReplyComposeContext {
  inbound: string;
  lastOutbound: string;
  roleSummary: string;
  /** Extra steering for this reply (for example: ask for a concrete time). */
  hint?: string;
}

export type ReplyComposer = (ctx: ReplyComposeContext) => Promise<string | null>;

export function envReplyProvider(env: NodeJS.ProcessEnv = process.env): { slug: AiProviderSlug; key: string } | null {
  const order: AiProviderSlug[] = ["anthropic", "openai", "groq", "mistral", "xai"];
  for (const slug of order) {
    const key = env[PROVIDER_ENV[slug]] ?? "";
    if (key && CLOUD_ENDPOINT[slug]) return { slug, key };
  }
  return null;
}

/** Compose with the server provider. Returns null when no provider is configured
 *  or the provider fails, so the caller falls back to human triage. */
export const composeReplyWithServerProvider: ReplyComposer = async (ctx) => {
  const provider = envReplyProvider();
  if (!provider) return null;
  const { system, prompt } = buildReplyPrompt({
    inbound: ctx.inbound,
    lastOutbound: ctx.lastOutbound,
    roleSummary: ctx.roleSummary,
  });
  const steered = ctx.hint ? `${prompt}\n\nAlso: ${ctx.hint}` : prompt;
  const request = buildCloudRequest(provider.slug, DEFAULT_MODEL[provider.slug], system, steered, provider.key, 512);
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const draft = parseCloudResponse(provider.slug, await response.json());
    return draft.trim() ? draft : null;
  } catch {
    return null;
  }
};
