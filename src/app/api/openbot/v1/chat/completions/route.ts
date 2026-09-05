/**
 * OpenAI-compatible chat completions proxy for OpenBot agents.
 * OpenBot sets OPENAI_BASE_URL → https://<aria>/api/openbot/v1 and
 * OPENAI_API_KEY → OPENBOT_LLM_PROXY_TOKEN. Aria then spends the same
 * vault/env LLM keys as the rest of the product (no separate OpenBot model keys).
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

type ChatMessage = {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
};

function proxyToken(): string {
  return (
    process.env.OPENBOT_LLM_PROXY_TOKEN ??
    process.env.ARIA_OPENBOT_LLM_TOKEN ??
    ""
  ).trim();
}

function authorized(req: NextRequest): boolean {
  const expected = proxyToken();
  if (!expected) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  return bearer.length > 0 && bearer === expected;
}

function envProvider(): { slug: AiProviderSlug; key: string } | null {
  const preferred = (process.env.OPENBOT_LLM_PROVIDER ?? "").trim().toLowerCase() as AiProviderSlug;
  const order = preferred && SLUG_ORDER.includes(preferred)
    ? [preferred, ...SLUG_ORDER.filter((s) => s !== preferred)]
    : SLUG_ORDER;
  for (const slug of order) {
    const key = (process.env[PROVIDER_ENV[slug]] ?? "").trim();
    if (key && CLOUD_ENDPOINT[slug]) return { slug, key };
  }
  return null;
}

function messageText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function openAiResponse(model: string, text: string) {
  return {
    id: `chatcmpl_openbot_${Math.random().toString(36).slice(2, 10)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export async function GET() {
  const provider = envProvider();
  if (!proxyToken()) {
    return NextResponse.json(
      { error: { message: "OPENBOT_LLM_PROXY_TOKEN is not configured on Aria." } },
      { status: 503 },
    );
  }
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

export async function POST(req: NextRequest) {
  if (!proxyToken()) {
    return NextResponse.json(
      { error: { message: "OPENBOT_LLM_PROXY_TOKEN is not configured on Aria." } },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: { message: "Unauthorized." } }, { status: 401 });
  }

  const provider = envProvider();
  if (!provider) {
    return NextResponse.json(
      { error: { message: "No Aria LLM provider key is configured." } },
      { status: 503 },
    );
  }

  let body: {
    model?: string;
    messages?: ChatMessage[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body." } }, { status: 400 });
  }

  if (body.stream) {
    return NextResponse.json(
      { error: { message: "Streaming is not supported on the Aria OpenBot LLM proxy." } },
      { status: 400 },
    );
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: { message: "messages is required." } }, { status: 400 });
  }

  const model =
    (typeof body.model === "string" && body.model.trim()) ||
    (process.env.OPENBOT_LLM_MODEL ?? "").trim() ||
    DEFAULT_MODEL[provider.slug];
  const maxTokens =
    typeof body.max_tokens === "number" && body.max_tokens > 0
      ? Math.min(body.max_tokens, 8192)
      : 2048;

  const systemParts: string[] = [];
  const chatMessages: Array<{ role: string; content: string }> = [];
  for (const msg of messages) {
    const role = (msg.role ?? "user").toLowerCase();
    const text = messageText(msg.content);
    if (!text) continue;
    if (role === "system") systemParts.push(text);
    else chatMessages.push({ role: role === "assistant" ? "assistant" : "user", content: text });
  }
  if (chatMessages.length === 0) {
    return NextResponse.json({ error: { message: "No user/assistant messages." } }, { status: 400 });
  }

  try {
    if (provider.slug === "anthropic") {
      const res = await fetch(CLOUD_ENDPOINT.anthropic, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": provider.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: systemParts.join("\n\n") || undefined,
          messages: chatMessages.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        content?: Array<{ text?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return NextResponse.json(
          { error: { message: json.error?.message || `Upstream ${res.status}` } },
          { status: 502 },
        );
      }
      const text = json.content?.[0]?.text ?? "";
      return NextResponse.json(openAiResponse(model, text));
    }

    const openAiMessages = [
      ...(systemParts.length
        ? [{ role: "system", content: systemParts.join("\n\n") }]
        : []),
      ...chatMessages,
    ];
    const res = await fetch(CLOUD_ENDPOINT[provider.slug], {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: openAiMessages,
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return NextResponse.json(
        { error: { message: json.error?.message || `Upstream ${res.status}` } },
        { status: 502 },
      );
    }
    const text = json.choices?.[0]?.message?.content ?? "";
    return NextResponse.json(openAiResponse(model, text));
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          message: err instanceof Error ? err.message : "OpenBot LLM proxy failed",
        },
      },
      { status: 502 },
    );
  }
}
