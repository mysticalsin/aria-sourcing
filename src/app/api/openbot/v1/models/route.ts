/**
 * OpenAI-compatible /v1/models for OpenBot agents pointed at Aria's LLM proxy.
 * Auth: same Aria provider API key OpenBot presents as OPENAI_API_KEY.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeOpenBotLlm,
  openBotLlmModelFor,
  openBotLlmReadyMessage,
} from "@/lib/openbot/llm-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = authorizeOpenBotLlm(req.headers.get("authorization"));
  if (!auth.ok) {
    const status = auth.reason === "missing_aria_key" ? 503 : 401;
    return NextResponse.json(
      { error: { message: openBotLlmReadyMessage(auth.reason) } },
      { status },
    );
  }

  const model = openBotLlmModelFor(auth.provider);
  return NextResponse.json({
    object: "list",
    data: [{ id: model, object: "model", owned_by: `aria:${auth.provider.slug}` }],
  });
}
