import {
  parseSourcingAgentCandidates,
  parseSourcingAgentSuccessResponse,
  type SourcingAgentSuccessResponse,
} from "./sourcing-agent-contract";

const SAFE_SOURCING_ERRORS: Readonly<Record<string, string>> = {
  CAMPAIGN_NOT_FOUND: "Campaign not found.",
  CAMPAIGN_NOT_ACTIVE: "Campaign is not active for sourcing.",
  CAMPAIGN_NOT_READY: "Complete and review the campaign brief before sourcing.",
  CAMPAIGN_INPUT_UNSAFE: "Review unsafe instructions in the campaign brief before sourcing.",
  CAMPAIGN_CHANGED: "Campaign authority changed. Retry from the current campaign.",
  INSUFFICIENT_PERMISSIONS: "Sourcing authority is no longer available.",
  SOURCING_AGENT_RATE_LIMITED: "The sourcing-agent rate limit was reached. Try again later.",
  SOURCING_AGENT_REPLAY_BLOCKED: "This sourcing request was already claimed. Start a new sourcing run.",
  SOURCING_AGENT_NOT_CONFIGURED: "The selected sourcing provider is not configured.",
  SOURCING_AGENT_UPSTREAM_FAILED: "The sourcing agent did not complete.",
  SOURCING_AGENT_RESPONSE_INVALID: "The sourcing agent returned an invalid result.",
};

export type ReviewedSourcingRequestResult =
  | { ok: true; value: SourcingAgentSuccessResponse }
  | { ok: false; error: string };

type OrdinarySourcingOperation = {
  operationId: string;
  count: number;
  createdAt: number;
  inFlight?: Promise<ReviewedSourcingRequestResult>;
  persistedReceipt?: {
    sourcingRunId: string;
    resultSha256: string;
  };
};

const MAX_ORDINARY_OPERATIONS = 32;
const ORDINARY_OPERATION_TTL_MS = 24 * 60 * 60 * 1_000;

// Store only bounded operation authority. Candidate payloads remain in the
// database staging row and are fetched again on retry, so browser memory never
// becomes a second unbounded PII store.
const ordinaryOperations = new Map<string, OrdinarySourcingOperation>();

function pruneOrdinaryOperations(now = Date.now()): void {
  for (const [campaignId, operation] of ordinaryOperations) {
    if (now - operation.createdAt >= ORDINARY_OPERATION_TTL_MS) {
      ordinaryOperations.delete(campaignId);
    }
  }
  while (ordinaryOperations.size >= MAX_ORDINARY_OPERATIONS) {
    const oldest = ordinaryOperations.keys().next().value as string | undefined;
    if (!oldest) break;
    ordinaryOperations.delete(oldest);
  }
}

export function completeReviewedSourcingOperation(
  campaignId: string,
  idempotencyKey: string,
): void {
  const current = ordinaryOperations.get(campaignId);
  if (current?.operationId === idempotencyKey) ordinaryOperations.delete(campaignId);
}

export function markReviewedSourcingOperationPersisted(
  campaignId: string,
  idempotencyKey: string,
  sourcingRunId: string,
  resultSha256: string,
): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourcingRunId) ||
    !/^[0-9a-f]{64}$/.test(resultSha256)
  ) return;
  const current = ordinaryOperations.get(campaignId);
  if (current?.operationId !== idempotencyKey) return;
  current.persistedReceipt = { sourcingRunId, resultSha256 };
}

export async function acknowledgeReviewedSourcing(
  workspaceFetch: typeof fetch,
  authority:
    | { sourcingRunId: string }
    | { frameworkRunId: string; capabilityToken: string },
  resultSha256: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(resultSha256)) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await workspaceFetch("/api/sourcing-agent/ack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "frameworkRunId" in authority
            ? authority.frameworkRunId
            : authority.sourcingRunId,
        },
        body: JSON.stringify({
          ...authority,
          resultSha256,
        }),
      });
      if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      const body = await response.json().catch(() => null);
      if (
        body !== null && typeof body === "object" && !Array.isArray(body) &&
        (body as Record<string, unknown>).ok === true &&
        (body as Record<string, unknown>).status === "completed"
      ) return true;
    } catch {
      // Exact acknowledgement is idempotent. One bounded retry covers a lost
      // response without repeating persistence or provider work.
    }
  }
  return false;
}

export async function requestReviewedSourcing(
  workspaceFetch: typeof fetch,
  campaignId: string,
  count: number,
  agentFramework?: { runId: string; capabilityToken: string; query: string },
): Promise<ReviewedSourcingRequestResult> {
  if (
    agentFramework &&
    (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agentFramework.runId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(agentFramework.capabilityToken)
      || agentFramework.query.trim() !== agentFramework.query
      || agentFramework.query.length < 3
      || agentFramework.query.length > 256)
  ) {
    return { ok: false, error: "The agent framework sourcing authorization is invalid." };
  }
  let ordinaryOperation: OrdinarySourcingOperation | undefined;
  if (!agentFramework) {
    pruneOrdinaryOperations();
    ordinaryOperation = ordinaryOperations.get(campaignId);
    if (!ordinaryOperation) {
      ordinaryOperation = { operationId: crypto.randomUUID(), count, createdAt: Date.now() };
      ordinaryOperations.set(campaignId, ordinaryOperation);
    }
    if (ordinaryOperation.inFlight) return ordinaryOperation.inFlight;
  }
  const execute = async (): Promise<ReviewedSourcingRequestResult> => {
    if (ordinaryOperation?.persistedReceipt) {
      const receipt = ordinaryOperation.persistedReceipt;
      const reconciled = await acknowledgeReviewedSourcing(
        workspaceFetch,
        { sourcingRunId: receipt.sourcingRunId },
        receipt.resultSha256,
      );
      if (!reconciled) {
        return {
          ok: false,
          error: "The prior sourcing persistence receipt could not be reconciled.",
        };
      }
      ordinaryOperation.operationId = crypto.randomUUID();
      ordinaryOperation.count = count;
      ordinaryOperation.createdAt = Date.now();
      delete ordinaryOperation.persistedReceipt;
    }
    const effectiveCount = ordinaryOperation?.count ?? count;
    const operationId = agentFramework?.runId ?? ordinaryOperation?.operationId ?? crypto.randomUUID();
    let response: Response;
    try {
      response = await workspaceFetch("/api/sourcing-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operationId,
          "X-Request-Id": operationId,
        },
        body: JSON.stringify({
          campaignId,
          count: effectiveCount,
          ...(agentFramework
            ? {
                agentFrameworkRunId: agentFramework.runId,
                agentFrameworkCapabilityToken: agentFramework.capabilityToken,
                agentFrameworkQuery: agentFramework.query,
              }
            : {}),
        }),
      });
    } catch {
      return { ok: false, error: "The sourcing agent could not be reached." };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
      return { ok: false, error: "The sourcing agent returned an invalid response." };
    }
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const code =
        body !== null && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).code
          : null;
      const safeCode = typeof code === "string" ? code : "";
      if (
        ordinaryOperation &&
        safeCode !== "SOURCING_AGENT_REPLAY_BLOCKED" &&
        safeCode !== "SOURCING_AGENT_RATE_LIMITED" &&
        safeCode !== "SOURCING_AGENT_UPSTREAM_FAILED" &&
        safeCode !== "SOURCING_AGENT_UNAVAILABLE" &&
        ordinaryOperations.get(campaignId) === ordinaryOperation
      ) {
        ordinaryOperations.delete(campaignId);
      }
      return {
        ok: false,
        error:
          safeCode && SAFE_SOURCING_ERRORS[safeCode]
            ? SAFE_SOURCING_ERRORS[safeCode]
            : "The sourcing agent is unavailable.",
      };
    }

    const parsed = parseSourcingAgentSuccessResponse(
      body,
      campaignId,
      agentFramework ? effectiveCount : 8,
      agentFramework?.runId,
    );
    return parsed
      ? { ok: true, value: parsed }
      : { ok: false, error: "The sourcing agent returned an invalid result." };
  };
  if (!ordinaryOperation) return execute();
  const inFlight = execute();
  ordinaryOperation.inFlight = inFlight;
  try {
    return await inFlight;
  } finally {
    if (ordinaryOperation.inFlight === inFlight) delete ordinaryOperation.inFlight;
  }
}
