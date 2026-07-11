/* Dust integration (server only). This deliberately uses Dust's narrow REST
   surface instead of the bundled SDK so ARIA owns timeout, validation, and
   dependency behavior without importing an incompatible transitive server. */

import { z } from "zod";
import type { DustAgentSummary, DustRegion } from "@/lib/types";
import { containsCredentialRepresentation } from "@/lib/credential-safety";

const REGION_BASE_URL: Record<DustRegion, string> = {
  us: "https://dust.tt",
  eu: "https://eu.dust.tt",
};

const AgentListSchema = z.object({
  agentConfigurations: z.array(
    z.object({
      sId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullish(),
    }).passthrough(),
  ),
});

const AgentMessageSchema = z.object({
  type: z.string().optional(),
  status: z.enum(["created", "succeeded", "failed", "cancelled"]).optional(),
  content: z.string().nullable().optional(),
  error: z.object({ message: z.string().optional() }).nullable().optional(),
}).passthrough();

const ConversationSchema = z.object({
  conversation: z.object({
    sId: z.string().min(1),
    content: z.array(z.array(AgentMessageSchema)).default([]),
  }).passthrough(),
});

export type { DustAgentSummary };
export type DustRunResult = { ok: true; text: string } | { ok: false; error: string };

const POLL_INTERVAL_MS = 1_200;
const MAX_RESPONSE_BYTES = 2_000_000;

class DustClientError extends Error {}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiUrl(workspaceId: string, path: string, region: DustRegion) {
  return `${REGION_BASE_URL[region]}/api/v1/w/${encodeURIComponent(workspaceId)}/${path}`;
}

function httpError(status: number): DustClientError {
  if (status === 401 || status === 403) return new DustClientError("Dust authentication failed.");
  if (status === 429) return new DustClientError("Dust rate limit exceeded.");
  if (status >= 400 && status < 500) return new DustClientError("Dust rejected the request.");
  return new DustClientError("Dust request failed.");
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
    try {
      await response.body?.cancel("response size limit exceeded");
    } catch {
      // The declared size violation remains the authoritative failure.
    }
    throw new DustClientError("Dust returned an oversized response.");
  }

  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const text: string[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel("response size limit exceeded");
        } catch {
          // The size violation remains the authoritative failure.
        }
        throw new DustClientError("Dust returned an oversized response.");
      }
      text.push(decoder.decode(value, { stream: true }));
    }
    text.push(decoder.decode());
    return text.join("");
  } finally {
    reader.releaseLock();
  }
}

async function requestJson(
  workspaceId: string,
  apiKey: string,
  path: string,
  region: DustRegion,
  init: RequestInit = {},
) {
  let response: Response;
  try {
    response = await fetch(apiUrl(workspaceId, path, region), {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new DustClientError("Dust request failed.");
  }
  const text = await readBoundedResponseText(response);
  // Provider-controlled failure bodies are never parsed or surfaced. The
  // status alone selects a stable client-owned error.
  if (!response.ok) throw httpError(response.status);
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new DustClientError("Dust returned an invalid JSON response.");
  }
  return body;
}

export async function listDustAgents(
  workspaceId: string,
  apiKey: string,
  region: DustRegion = "us",
): Promise<DustAgentSummary[]> {
  const body = await requestJson(
    workspaceId,
    apiKey,
    "assistant/agent_configurations?view=all&withAuthors=true",
    region,
    { signal: AbortSignal.timeout(10_000) },
  );
  const parsed = AgentListSchema.safeParse(body);
  if (!parsed.success) throw new DustClientError("Dust returned an invalid agent-list response.");
  return parsed.data.agentConfigurations.map((agent) => ({
    sId: agent.sId,
    name: agent.name,
    description: agent.description ?? "",
  }));
}

export async function runDustAgent(
  workspaceId: string,
  apiKey: string,
  agentSId: string,
  message: string,
  timeoutMs = 25_000,
  region: DustRegion = "us",
): Promise<DustRunResult> {
  const deadline = Date.now() + timeoutMs;
  try {
    const createdBody = await requestJson(
      workspaceId,
      apiKey,
      "assistant/conversations",
      region,
      {
        method: "POST",
        body: JSON.stringify({
          title: null,
          visibility: "unlisted",
          blocking: false,
          skipToolsValidation: false,
          message: {
            content: message,
            mentions: [{ configurationId: agentSId }],
            context: {
              username: "aria-fleet",
              timezone: resolveTimezone(),
              fullName: "Aria Sourcing Fleet",
              email: null,
              profilePictureUrl: null,
              origin: "api",
            },
          },
        }),
        signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
      },
    );
    const created = ConversationSchema.safeParse(createdBody);
    if (!created.success) return { ok: false, error: "Dust returned an invalid conversation response." };
    const conversationId = created.data.conversation.sId;

    while (Date.now() < deadline) {
      const body = await requestJson(
        workspaceId,
        apiKey,
        `assistant/conversations/${encodeURIComponent(conversationId)}`,
        region,
        { signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())) },
      );
      const got = ConversationSchema.safeParse(body);
      if (!got.success) return { ok: false, error: "Dust returned an invalid conversation response." };
      const latest = got.data.conversation.content
        .map((versions) => versions.at(-1))
        .find((candidate) => candidate?.type === "agent_message");
      if (latest?.status === "succeeded") {
        const text = latest.content ?? "";
        if (containsCredentialRepresentation(text, apiKey)) {
          return { ok: false, error: "Dust returned an unsafe response." };
        }
        return { ok: true, text };
      }
      if (latest?.status === "failed" || latest?.status === "cancelled") {
        return { ok: false, error: latest.status === "failed" ? "Dust agent run failed." : "Dust agent run cancelled." };
      }
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }
    return { ok: false, error: "Timed out waiting for the Dust agent to respond." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof DustClientError ? error.message : "Dust request failed.",
    };
  }
}
