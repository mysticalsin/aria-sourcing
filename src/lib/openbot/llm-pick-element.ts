/**
 * Optional Aria LLM assist for picking an OpenBot snapshot element.
 * Uses the same Aria PROVIDER_ENV keys as the OpenBot LLM proxy / hermes.
 */

import { CLOUD_ENDPOINT } from "@/lib/ai/provider";
import type { OpenBotSnapshotElement } from "@/lib/openbot/agent-computer-client";
import {
  isCloudflareWorkersAiProvider,
  openBotLlmModelFor,
  resolveAriaLlmProvider,
} from "@/lib/openbot/llm-auth";

/** Prefer names from compact lesson hints like `ui:prefer:Connect;avoid:Message`. */
function preferredNamesFromGoal(goal: string): string[] {
  const names: string[] = [];
  for (const m of goal.matchAll(/prefer:([^;\s]+)/gi)) {
    if (m[1]) names.push(m[1].toLowerCase());
  }
  return names;
}

function compactElements(elements: OpenBotSnapshotElement[], goal: string, limit = 80): string {
  const preferred = preferredNamesFromGoal(goal);
  let list = elements;
  // When lessons already named the control, shrink the prompt (token save).
  if (preferred.length > 0) {
    const filtered = elements.filter((el) => {
      const n = el.name.trim().toLowerCase();
      return preferred.some((p) => n === p || n.includes(p));
    });
    if (filtered.length > 0) list = filtered;
    limit = Math.min(limit, 24);
  }
  return list
    .slice(0, limit)
    .map((el, i) => `${i}. ref=${el.ref} role=${el.role} name=${JSON.stringify(el.name)}`)
    .join("\n");
}

/**
 * Ask Aria's configured cloud LLM which snapshot ref matches `goal`.
 * Supports OpenAI-compatible providers and Cloudflare Workers AI.
 */
export async function pickOpenBotElementWithAriaLlm(
  elements: OpenBotSnapshotElement[],
  goal: string,
): Promise<OpenBotSnapshotElement | undefined> {
  if (elements.length === 0) return undefined;
  if (process.env.OPENBOT_LLM_PICK === "0") return undefined;

  const provider = resolveAriaLlmProvider();
  if (!provider || provider.slug === "anthropic") return undefined;

  const model = openBotLlmModelFor(provider);
  const system =
    "You pick UI elements for LinkedIn browser automation. " +
    'Reply with ONLY JSON: {"ref":"..."} from the list, or {"ref":null}.';
  const user = `Goal: ${goal}\n\nElements:\n${compactElements(elements, goal)}`;

  try {
    let text = "";
    if (isCloudflareWorkersAiProvider(provider)) {
      const endpoint = (provider.endpoint ?? "").trim();
      if (!endpoint) return undefined;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${provider.key}`,
        },
        body: JSON.stringify({ prompt: `${system}\n\n${user}` }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return undefined;
      const json = (await res.json()) as { ok?: boolean; text?: string };
      if (json.ok === false) return undefined;
      text = (json.text ?? "").trim();
    } else {
      const endpoint = CLOUD_ENDPOINT[provider.slug as keyof typeof CLOUD_ENDPOINT];
      if (!endpoint) return undefined;
      const res = await fetch(endpoint, {
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
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return undefined;
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      text = json.choices?.[0]?.message?.content?.trim() ?? "";
    }

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    const parsed = JSON.parse(match[0]) as { ref?: string | null };
    if (!parsed.ref || typeof parsed.ref !== "string") return undefined;
    return elements.find((el) => el.ref === parsed.ref && !el.disabled);
  } catch {
    return undefined;
  }
}
