/**
 * Optional Aria LLM assist for picking an OpenBot snapshot element.
 * Uses the same cloud provider env keys as the rest of Aria (PROVIDER_ENV).
 */

import {
  CLOUD_ENDPOINT,
  DEFAULT_MODEL,
  PROVIDER_ENV,
  type AiProviderSlug,
} from "@/lib/ai/provider";
import type { OpenBotSnapshotElement } from "@/lib/openbot/agent-computer-client";

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

function envProvider(): { slug: AiProviderSlug; key: string } | null {
  for (const slug of SLUG_ORDER) {
    const key = (process.env[PROVIDER_ENV[slug]] ?? "").trim();
    if (key && CLOUD_ENDPOINT[slug]) return { slug, key };
  }
  return null;
}

function compactElements(elements: OpenBotSnapshotElement[], limit = 80): string {
  return elements
    .slice(0, limit)
    .map((el, i) => `${i}. ref=${el.ref} role=${el.role} name=${JSON.stringify(el.name)}`)
    .join("\n");
}

/**
 * Ask Aria's configured cloud LLM which snapshot ref matches `goal`.
 * OpenAI-compatible providers only (JSON one-liner).
 */
export async function pickOpenBotElementWithAriaLlm(
  elements: OpenBotSnapshotElement[],
  goal: string,
): Promise<OpenBotSnapshotElement | undefined> {
  if (elements.length === 0) return undefined;
  if (process.env.OPENBOT_LLM_PICK === "0") return undefined;

  const provider = envProvider();
  if (!provider || provider.slug === "anthropic") return undefined;

  const model =
    (process.env.OPENBOT_LLM_MODEL ?? "").trim() || DEFAULT_MODEL[provider.slug];

  try {
    const res = await fetch(CLOUD_ENDPOINT[provider.slug], {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 64,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You pick UI elements for LinkedIn browser automation. " +
              'Reply with ONLY JSON: {"ref":"..."} from the list, or {"ref":null}.',
          },
          {
            role: "user",
            content: `Goal: ${goal}\n\nElements:\n${compactElements(elements)}`,
          },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    const parsed = JSON.parse(match[0]) as { ref?: string | null };
    if (!parsed.ref || typeof parsed.ref !== "string") return undefined;
    return elements.find((el) => el.ref === parsed.ref && !el.disabled);
  } catch {
    return undefined;
  }
}
