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
  MISSING_PLUGIN:
    "Connect LinkedIn and Apify in Settings. GitHub Sourcing cannot fill this role, even when toggled Live.",
  INSUFFICIENT_PERMISSIONS: "Sourcing authority is no longer available.",
  SOURCING_AGENT_RATE_LIMITED: "The sourcing-agent rate limit was reached. Try again later.",
  SOURCING_AGENT_REPLAY_BLOCKED: "This sourcing request was already claimed. Start a new sourcing run.",
  SOURCING_AGENT_NOT_CONFIGURED: "The selected sourcing provider is not configured.",
  SOURCING_AGENT_UPSTREAM_FAILED: "The sourcing agent did not complete.",
  SOURCING_AGENT_RESPONSE_INVALID: "The sourcing agent returned an invalid result.",
};

export type ReviewedSourcingRequestResult =
  | { ok: true; value: SourcingAgentSuccessResponse }
  | { ok: false; error: string; code?: string; settingsHref?: string };

export async function acknowledgeReviewedSourcing(
  workspaceFetch: typeof fetch,
  agentFramework: { runId: string; capabilityToken: string },
  resultSha256: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(resultSha256)) return false;
  try {
    const response = await workspaceFetch("/api/sourcing-agent/ack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": agentFramework.runId,
      },
      body: JSON.stringify({
        frameworkRunId: agentFramework.runId,
        capabilityToken: agentFramework.capabilityToken,
        resultSha256,
      }),
    });
    if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    const body = await response.json().catch(() => null);
    return body !== null && typeof body === "object" && !Array.isArray(body) &&
      (body as Record<string, unknown>).ok === true &&
      (body as Record<string, unknown>).status === "completed";
  } catch {
    return false;
  }
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
  const operationId = agentFramework?.runId ?? crypto.randomUUID();
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
        count,
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
  const isJson = contentType.split(";", 1)[0]?.trim() === "application/json";
  // Non-JSON (HTML error page from a crashed route module, proxy page, etc.)
  // must not throw — surface a stable client error. Prefer JSON error envelopes
  // when the content-type is correct.
  if (!isJson) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, error: "The sourcing agent returned an invalid response." };
  }
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const record =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    const code = typeof record?.code === "string" ? record.code : null;
    const settingsHref =
      typeof record?.settingsHref === "string" ? record.settingsHref : undefined;
    const serverError =
      typeof record?.error === "string" && record.error.trim() ? record.error.trim() : null;
    return {
      ok: false,
      error:
        code === "MISSING_PLUGIN" && serverError
          ? serverError
          : typeof code === "string" && SAFE_SOURCING_ERRORS[code]
            ? SAFE_SOURCING_ERRORS[code]
            : "The sourcing agent is unavailable.",
      ...(code ? { code } : {}),
      ...(settingsHref ? { settingsHref } : {}),
    };
  }

  const parsed = parseSourcingAgentSuccessResponse(
    body,
    campaignId,
    count,
    agentFramework?.runId,
  );
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, error: "The sourcing agent returned an invalid result." };
}
