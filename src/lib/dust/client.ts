/* ============================================================================
   Dust AI-agent integration (SERVER ONLY).

   Thin wrapper around the official "@dust-tt/client" SDK. Two operations:
     - listDustAgents : list the workspace's agent configurations (for the
       Settings "Configure" flow to pick which agent to lock to a task).
     - runDustAgent   : run one agent turn (create a conversation, mention the
       agent, poll for its reply) and return its text.

   Dust's public API only streams the agent's reply over SSE
   (dustAPI.streamAgentAnswerEvents). Wiring raw SSE through a Next.js
   serverless route handler is fiddly to get right (reconnects, partial
   frames); polling GET .../conversations/{id} until the agent message
   settles is Dust's documented simpler alternative for non-streaming callers,
   and matches every other server->LLM call in this app (hermes/chat is also
   non-streaming for the default path). Bounded end-to-end by `timeoutMs`.

   Never throws out of runDustAgent — a Dust-side or network failure resolves
   to { ok: false, error }, matching the "surface, don't retry-loop" guidance
   for a service with a shared daily message quota.
   ========================================================================== */

import { DustAPI } from "@dust-tt/client";
import { safeLog } from "@/lib/log-redact";
import type { DustAgentSummary } from "@/lib/types";

// Re-exported so existing callers of this module keep working unchanged — the
// shape now lives in types.ts (client-safe) since the Settings UI needs it too
// and must not import this server-only module.
export type { DustAgentSummary };

/** The SDK requires a logger (default: `console`, which would print raw
 *  upstream error text straight to stdout). Route it through safeLog so any
 *  diagnostic is redacted first, matching this codebase's logging convention.
 *  Never receives the API key itself (that only ever lives in the Authorization
 *  header the SDK builds internally). */
const dustLogger = {
  error: (args: Record<string, unknown>, msg: string) => safeLog("[dust]", msg, args),
  warn: (args: Record<string, unknown>, msg: string) => safeLog("[dust]", msg, args),
  info: () => {},
  trace: () => {},
};

function buildClient(workspaceId: string, apiKey: string): DustAPI {
  return new DustAPI({ workspaceId, apiKey, logger: dustLogger });
}

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

/**
 * List the workspace's agent configurations (view=all, i.e. every agent the
 * caller's role can see, matching the confirmed API contract). Throws on any
 * Dust-side or network error — the /api/dust/test route wraps this call in
 * try/catch and turns a throw into { ok: false, error }.
 */
export async function listDustAgents(workspaceId: string, apiKey: string): Promise<DustAgentSummary[]> {
  const dust = buildClient(workspaceId, apiKey);
  const res = await dust.getAgentConfigurations({ view: "all", includes: ["authors"] });
  if (res.isErr()) {
    throw new Error(res.error.message || "Failed to list Dust agents.");
  }
  return res.value.map((a) => ({ sId: a.sId, name: a.name, description: a.description ?? "" }));
}

/** The subset of an agent_message's fields this wrapper reads while polling.
 *  The SDK's full response type is a large zod-inferred union covering every
 *  provider/model variant; asserting this narrow shape keeps the wrapper
 *  maintainable while still failing safely — an unexpected shape just reads as
 *  "not yet the agent message" and falls through to the next poll / timeout,
 *  never a crash. Verified against the SDK's actual runtime zod schema
 *  (GetConversationResponseSchema) at the time of writing. */
interface DustAgentMessagePoll {
  type?: string;
  status?: "created" | "succeeded" | "failed" | "cancelled";
  content?: string | null;
  error?: { message?: string } | null;
}

const POLL_INTERVAL_MS = 1_200;

export type DustRunResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Run one turn of a Dust agent: create an unlisted conversation mentioning the
 * agent, then poll until its message succeeds, fails, is cancelled, or the
 * timeout elapses. Never throws.
 */
export async function runDustAgent(
  workspaceId: string,
  apiKey: string,
  agentSId: string,
  message: string,
  timeoutMs = 25_000,
): Promise<DustRunResult> {
  const deadline = Date.now() + timeoutMs;
  try {
    const dust = buildClient(workspaceId, apiKey);

    const created = await dust.createConversation({
      title: null,
      visibility: "unlisted",
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
      signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
    });
    if (created.isErr()) {
      return { ok: false, error: created.error.message || "Failed to start a Dust conversation." };
    }
    const conversationId = created.value.conversation.sId;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const got = await dust.getConversation({
        conversationId,
        signal: AbortSignal.timeout(Math.max(1_000, remaining)),
      });
      if (got.isErr()) {
        return { ok: false, error: got.error.message || "Failed to read the Dust conversation." };
      }
      // content is an array of message "slots"; each slot holds every version of
      // that message (edits/regenerations), current version last.
      const groups = got.value.content as unknown as DustAgentMessagePoll[][];
      const latest = groups.map((g) => g[g.length - 1]).find((m) => m?.type === "agent_message");
      if (latest) {
        if (latest.status === "succeeded") return { ok: true, text: latest.content ?? "" };
        if (latest.status === "failed" || latest.status === "cancelled") {
          return { ok: false, error: latest.error?.message || `Dust agent run ${latest.status}.` };
        }
        // status === "created" (still running) — keep polling.
      }
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }
    return { ok: false, error: "Timed out waiting for the Dust agent to respond." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error calling Dust.";
    return { ok: false, error: msg };
  }
}
