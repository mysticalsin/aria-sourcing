/**
 * OpenAI-compatible /v1/models for OpenBot agents pointed at Aria's LLM proxy.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  CLOUD_ENDPOINT,
  DEFAULT_MODEL,
  PROVIDER_ENV,
  type AiProviderSlug,
} from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_ORDER: AiProviderSlug[] = [
  "openai",
  "anthropic",
  "groq",
  "mistral",
  "xai",
  "kimi",
  "deepseek",
  "nvidia",
];

function proxyToken(): string {
  return (
    process.env.OPENBOT_LLM_PROXY_TOKEN ??
    process.env.ARIA_OPENBOT_LLM_TOKEN ??
    ""
  ).trim();
}

function envProvider(): { slug: AiProviderSlug; key: string } | null {
  for (const slug of SLUG_ORDER) {
    const key = (process.env[PROVIDER_ENV[slug]] ?? "").trim();
    if (key && CLOUD_ENDPOINT[slug]) return { slug, key };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const expected = proxyToken();
  if (!expected) {
    return NextResponse.json(
      { error: { message: "OPENBOT_LLM_PROXY_TOKEN is not configured on Aria." } },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (!bearer || bearer !== expected) {
    return NextResponse.json({ error: { message: "Unauthorized." } }, { status: 401 });
  }

  const provider = envProvider();
  if (!provider) {
    return NextResponse.json(
      { error: { message: "No Aria LLM provider key is configured." } },
      { status: 503 },
    );
  }
  const model =
    (process.env.OPENBOT_LLM_MODEL ?? "").trim() || DEFAULT_MODEL[provider.slug];
  return NextResponse.json({
    object: "list",
    data: [{ id: model, object: "model", owned_by: `aria:${provider.slug}` }],
  });
}
