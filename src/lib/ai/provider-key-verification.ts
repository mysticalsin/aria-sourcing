import { randomUUID } from "node:crypto";

import { CLOUD_ENDPOINT, KIMI_BASE_URL, type AiProviderSlug } from "@/lib/ai/provider";

export type ExecutionCredentialProvider =
  | "Anthropic"
  | "OpenAI"
  | "Groq"
  | "xAI"
  | "Mistral"
  | "Kimi (Moonshot)"
  | "Tavily";

export type ExecutionCredentialVerification = {
  state: "verified" | "rejected" | "unavailable";
  status: "valid" | "invalid" | "untested";
  method: "provider_models_list_v1" | "tavily_usage_v1" | null;
  httpStatus: number | null;
  detail: string;
};

export type CredentialProbeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ExecutionModelPurpose = "requisition_parse" | "sourcing";

export type ExecutionModelCapabilityVerification = {
  state: "verified" | "rejected" | "unavailable";
  method: "provider_model_capability_v1" | null;
  httpStatus: number | null;
  detail: string;
};

const MODEL_PROBES: Record<Exclude<ExecutionCredentialProvider, "Tavily">, {
  url: string;
  headers: (key: string) => Record<string, string>;
}> = {
  // Official, non-completion model-list endpoints. These authenticate the key
  // without spending completion or search credits.
  Anthropic: {
    url: "https://api.anthropic.com/v1/models?limit=1",
    headers: (key) => ({
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": key,
    }),
  },
  OpenAI: {
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ accept: "application/json", authorization: `Bearer ${key}` }),
  },
  Groq: {
    url: "https://api.groq.com/openai/v1/models",
    headers: (key) => ({ accept: "application/json", authorization: `Bearer ${key}` }),
  },
  xAI: {
    url: "https://api.x.ai/v1/models",
    headers: (key) => ({ accept: "application/json", authorization: `Bearer ${key}` }),
  },
  Mistral: {
    url: "https://api.mistral.ai/v1/models",
    headers: (key) => ({ accept: "application/json", authorization: `Bearer ${key}` }),
  },
  "Kimi (Moonshot)": {
    url: `${KIMI_BASE_URL}/models`,
    headers: (key) => ({ accept: "application/json", authorization: `Bearer ${key}` }),
  },
};

const TAVILY_USAGE_URL = "https://api.tavily.com/usage";
const PROBE_TIMEOUT_MS = 8_000;
const MAX_TAVILY_USAGE_BYTES = 4_096;
const MAX_MODEL_CAPABILITY_BYTES = 64_000;
const MODEL_CAPABILITY_TIMEOUT_MS = 20_000;
const CAPABILITY_TOOL_NAME = "aria_runtime_capability_probe";

const PROVIDER_SLUG: Record<Exclude<ExecutionCredentialProvider, "Tavily">, AiProviderSlug> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Groq: "groq",
  xAI: "xai",
  Mistral: "mistral",
  "Kimi (Moonshot)": "kimi",
};

export function isExecutionCredentialProvider(
  provider: string,
): provider is ExecutionCredentialProvider {
  return provider === "Tavily" || Object.hasOwn(MODEL_PROBES, provider);
}

function unavailable(
  provider: ExecutionCredentialProvider,
  httpStatus: number | null,
): ExecutionCredentialVerification {
  return {
    state: "unavailable",
    status: "untested",
    method: null,
    httpStatus,
    detail: `${provider} verification is temporarily unavailable.`,
  };
}

function validSecret(value: string): boolean {
  return Boolean(
    value &&
    value.length <= 8_192 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validModelName(value: string): boolean {
  return Boolean(
    value &&
    new TextEncoder().encode(value).byteLength <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The verification result is based only on the fixed endpoint and status.
  }
}

async function readCappedJson(response: Response, maxBytes: number): Promise<unknown | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation failure; no upstream content is exposed.
    }
    return null;
  }
}

/**
 * Authenticate an execution credential against a fixed official, non-billable
 * readiness endpoint. No response body or upstream error is returned or logged.
 * Tavily's authenticated usage endpoint verifies ordinary and Enterprise keys
 * without executing a billable search.
 */
export async function verifyExecutionCredential(
  provider: ExecutionCredentialProvider,
  key: string,
  fetchImpl: CredentialProbeFetch = fetch,
): Promise<ExecutionCredentialVerification> {
  if (!validSecret(key)) {
    return {
      state: "rejected",
      status: "invalid",
      method: null,
      httpStatus: null,
      detail: `${provider} rejected this credential.`,
    };
  }

  const isTavily = provider === "Tavily";
  let url: string;
  let headers: Record<string, string>;
  if (provider === "Tavily") {
    url = TAVILY_USAGE_URL;
    headers = { accept: "application/json", authorization: `Bearer ${key}` };
  } else {
    const probe = MODEL_PROBES[provider];
    url = probe.url;
    headers = probe.headers(key);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return unavailable(provider, null);
  }

  if (response.status !== 200) {
    await cancelBody(response);
    if (response.status === 401 || response.status === 403) {
      return {
        state: "rejected",
        status: "invalid",
        method: null,
        httpStatus: response.status,
        detail: `${provider} rejected this credential.`,
      };
    }
    return unavailable(provider, response.status);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    await cancelBody(response);
    return unavailable(provider, response.status);
  }

  if (isTavily) {
    const body = await readCappedJson(response, MAX_TAVILY_USAGE_BYTES);
    const keyUsage = body && typeof body === "object" && !Array.isArray(body)
      ? (body as { key?: unknown }).key
      : null;
    const accountUsage = body && typeof body === "object" && !Array.isArray(body)
      ? (body as { account?: unknown }).account
      : null;
    if (
      !keyUsage ||
      typeof keyUsage !== "object" ||
      Array.isArray(keyUsage) ||
      !accountUsage ||
      typeof accountUsage !== "object" ||
      Array.isArray(accountUsage) ||
      !Number.isSafeInteger((keyUsage as { usage?: unknown }).usage) ||
      Number((keyUsage as { usage?: unknown }).usage) < 0 ||
      !Number.isSafeInteger((keyUsage as { limit?: unknown }).limit) ||
      Number((keyUsage as { limit?: unknown }).limit) < 0 ||
      typeof (accountUsage as { current_plan?: unknown }).current_plan !== "string" ||
      !(accountUsage as { current_plan: string }).current_plan.trim()
    ) {
      return unavailable(provider, 200);
    }
    return {
      state: "verified",
      status: "valid",
      method: "tavily_usage_v1",
      httpStatus: 200,
      detail: "Tavily authentication verified.",
    };
  }

  await cancelBody(response);
  return {
    state: "verified",
    status: "valid",
    method: "provider_models_list_v1",
    httpStatus: 200,
    detail: `${provider} authentication verified.`,
  };
}


function capabilityHeaders(
  provider: Exclude<ExecutionCredentialProvider, "Tavily">,
  key: string,
): Record<string, string> {
  return provider === "Anthropic"
    ? {
        accept: "application/json",
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": key,
      }
    : {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      };
}

function capabilityBody(
  provider: Exclude<ExecutionCredentialProvider, "Tavily">,
  model: string,
  purpose: ExecutionModelPurpose,
  nonce: string,
): Record<string, unknown> {
  if (purpose === "requisition_parse") {
    const instruction =
      'Return only this JSON object with no markdown or additional keys: {"aria_runtime_probe":true}';
    return provider === "Anthropic"
      ? {
          model,
          max_tokens: 32,
          system: "You are a strict JSON extraction endpoint capability probe.",
          messages: [{ role: "user", content: instruction }],
        }
      : {
          model,
          max_tokens: 32,
          messages: [
            { role: "system", content: "You are a strict JSON extraction endpoint capability probe." },
            { role: "user", content: instruction },
          ],
          stream: false,
        };
  }

  const parameters = {
    type: "object",
    properties: { nonce: { type: "string", enum: [nonce] } },
    required: ["nonce"],
    additionalProperties: false,
  };
  const prompt = `Call ${CAPABILITY_TOOL_NAME} exactly once with nonce ${nonce}.`;
  return provider === "Anthropic"
    ? {
        model,
        max_tokens: 64,
        messages: [{ role: "user", content: prompt }],
        tools: [{
          name: CAPABILITY_TOOL_NAME,
          description: "Proves this exact model can execute the sourcing tool-call protocol.",
          input_schema: parameters,
        }],
        tool_choice: {
          type: "tool",
          name: CAPABILITY_TOOL_NAME,
          disable_parallel_tool_use: true,
        },
      }
    : {
        model,
        max_tokens: 64,
        messages: [{ role: "user", content: prompt }],
        tools: [{
          type: "function",
          function: {
            name: CAPABILITY_TOOL_NAME,
            description: "Proves this exact model can execute the sourcing tool-call protocol.",
            parameters,
          },
        }],
        tool_choice: { type: "function", function: { name: CAPABILITY_TOOL_NAME } },
        // Kimi's documented OpenAI-compatible Tool Use surface accepts tools
        // and tool_choice but does not advertise parallel_tool_calls. The
        // response validator below still requires exactly one nonce-bound call.
        ...(provider === "Kimi (Moonshot)" ? {} : { parallel_tool_calls: false }),
        stream: false,
      };
}

function hasRequisitionCapability(
  provider: Exclude<ExecutionCredentialProvider, "Tavily">,
  body: unknown,
): boolean {
  let text: unknown;
  if (provider === "Anthropic") {
    text = (body as { content?: Array<{ type?: unknown; text?: unknown }> } | null)
      ?.content?.find((item) => item?.type === "text")?.text;
  } else {
    text = (body as { choices?: Array<{ message?: { content?: unknown } }> } | null)
      ?.choices?.[0]?.message?.content;
  }
  if (typeof text !== "string") return false;
  try {
    const parsed = JSON.parse(text.trim()) as unknown;
    return Boolean(
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      (parsed as { aria_runtime_probe?: unknown }).aria_runtime_probe === true
    );
  } catch {
    return false;
  }
}

function hasSourcingCapability(
  provider: Exclude<ExecutionCredentialProvider, "Tavily">,
  body: unknown,
  nonce: string,
): boolean {
  if (provider === "Anthropic") {
    const content = (body as {
      content?: Array<{ type?: unknown; name?: unknown; input?: unknown }>;
    } | null)?.content;
    if (!Array.isArray(content)) return false;
    return content.some((item) =>
      item?.type === "tool_use" &&
      item.name === CAPABILITY_TOOL_NAME &&
      item.input !== null &&
      typeof item.input === "object" &&
      !Array.isArray(item.input) &&
      Object.keys(item.input).length === 1 &&
      (item.input as { nonce?: unknown }).nonce === nonce
    );
  }

  const calls = (body as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          type?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        }>;
      };
    }>;
  } | null)?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls) || calls.length !== 1) return false;
  const call = calls[0];
  if (
    call?.type !== "function" ||
    call.function?.name !== CAPABILITY_TOOL_NAME ||
    typeof call.function.arguments !== "string"
  ) return false;
  try {
    const args = JSON.parse(call.function.arguments) as unknown;
    return Boolean(
      args &&
      typeof args === "object" &&
      !Array.isArray(args) &&
      Object.keys(args).length === 1 &&
      (args as { nonce?: unknown }).nonce === nonce
    );
  } catch {
    return false;
  }
}

function modelCapabilityResult(
  provider: Exclude<ExecutionCredentialProvider, "Tavily">,
  purpose: ExecutionModelPurpose,
  state: ExecutionModelCapabilityVerification["state"],
  httpStatus: number | null,
): ExecutionModelCapabilityVerification {
  if (state === "verified") {
    return {
      state,
      method: "provider_model_capability_v1",
      httpStatus,
      detail: `${provider} ${purpose} capability verified for the exact model.`,
    };
  }
  return {
    state,
    method: null,
    httpStatus,
    detail: state === "rejected"
      ? `${provider} rejected the exact model capability for this purpose.`
      : `${provider} exact-model capability verification is temporarily unavailable.`,
  };
}

/**
 * Prove that the authenticated credential can run the exact selected model on
 * the same protocol the requested purpose uses in production. A successful
 * model-list response is deliberately insufficient: parse bindings must emit
 * strict JSON, and sourcing bindings must emit a nonce-bound tool call.
 */
export async function verifyExecutionModelCapability(
  provider: Exclude<ExecutionCredentialProvider, "Tavily">,
  key: string,
  model: string,
  purpose: ExecutionModelPurpose,
  fetchImpl: CredentialProbeFetch = fetch,
): Promise<ExecutionModelCapabilityVerification> {
  if (
    !validSecret(key) ||
    !validModelName(model) ||
    (purpose !== "requisition_parse" && purpose !== "sourcing")
  ) {
    return modelCapabilityResult(provider, purpose, "rejected", null);
  }

  const nonce = randomUUID();
  let response: Response;
  try {
    response = await fetchImpl(CLOUD_ENDPOINT[PROVIDER_SLUG[provider]], {
      method: "POST",
      headers: capabilityHeaders(provider, key),
      body: JSON.stringify(capabilityBody(provider, model, purpose, nonce)),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(MODEL_CAPABILITY_TIMEOUT_MS),
    });
  } catch {
    return modelCapabilityResult(provider, purpose, "unavailable", null);
  }

  if (response.status !== 200) {
    await cancelBody(response);
    const rejected = [400, 401, 403, 404, 405, 409, 422].includes(response.status);
    return modelCapabilityResult(
      provider,
      purpose,
      rejected ? "rejected" : "unavailable",
      response.status,
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    await cancelBody(response);
    return modelCapabilityResult(provider, purpose, "unavailable", 200);
  }
  const body = await readCappedJson(response, MAX_MODEL_CAPABILITY_BYTES);
  const proved = purpose === "requisition_parse"
    ? hasRequisitionCapability(provider, body)
    : hasSourcingCapability(provider, body, nonce);
  return modelCapabilityResult(provider, purpose, proved ? "verified" : "rejected", 200);
}
