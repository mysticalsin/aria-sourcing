/**
 * OpenAI-compatible chat completions proxy for OpenBot agents.
 * OpenBot sets OPENAI_BASE_URL → https://<aria>/api/openbot/v1 and
 * OPENAI_API_KEY → the same Aria provider key (e.g. OPENAI_API_KEY).
 * Aria authenticates that Bearer and spends the same key upstream.
 */

import { NextResponse, type NextRequest } from "next/server";
import { CLOUD_ENDPOINT } from "@/lib/ai/provider";
import {
  authorizeOpenBotLlm,
  isCloudflareWorkersAiProvider,
  openBotLlmModelFor,
  openBotLlmReadyMessage,
  resolveAriaLlmProvider,
} from "@/lib/openbot/llm-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
};

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
  const provider = resolveAriaLlmProvider();
  if (!provider) {
    return NextResponse.json(
      { error: { message: openBotLlmReadyMessage("not_ready") } },
      { status: 503 },
    );
  }
  const model = openBotLlmModelFor(provider);
  return NextResponse.json({
    object: "list",
    data: [{ id: model, object: "model", owned_by: `aria:${provider.slug}` }],
  });
}

export async function POST(req: NextRequest) {
  const auth = authorizeOpenBotLlm(req.headers.get("authorization"));
  if (!auth.ok) {
    const status = auth.reason === "missing_aria_key" ? 503 : 401;
    return NextResponse.json(
      { error: { message: openBotLlmReadyMessage(auth.reason) } },
      { status },
    );
  }
  const provider = auth.provider;

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
    openBotLlmModelFor(provider);
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
    if (isCloudflareWorkersAiProvider(provider)) {
      const endpoint = (provider.endpoint ?? "").trim();
      if (!endpoint) {
        return NextResponse.json(
          { error: { message: "CLOUDFLARE_WORKERS_AI_URL is not configured." } },
          { status: 503 },
        );
      }
      const prompt = [
        ...(systemParts.length ? [`System:\n${systemParts.join("\n\n")}`] : []),
        ...chatMessages.map((m) => `${m.role}:\n${m.content}`),
      ].join("\n\n");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${provider.key}`,
        },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(120_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        text?: string;
        model?: string;
        reason?: string;
        error?: { message?: string };
      };
      if (!res.ok || json.ok === false) {
        return NextResponse.json(
          {
            error: {
              message:
                json.error?.message ||
                json.reason ||
                `Upstream ${res.status}`,
            },
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        openAiResponse(json.model || model, json.text ?? ""),
      );
    }

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
    const endpoint = CLOUD_ENDPOINT[provider.slug as keyof typeof CLOUD_ENDPOINT];
    if (!endpoint) {
      return NextResponse.json(
        { error: { message: `No upstream endpoint for provider ${provider.slug}` } },
        { status: 503 },
      );
    }
    const res = await fetch(endpoint, {
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
