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
  SOURCING_AGENT_RESPONSE_INVALID: "The model returned no usable sourcing result. Choose a tool-capable model, or disable the provider to use deterministic sourcing.",
};

export type ReviewedSourcingRequestResult =
  | { ok: true; value: SourcingAgentSuccessResponse }
  | { ok: false; error: string };

export async function requestReviewedSourcing(
  workspaceFetch: typeof fetch,
  campaignId: string,
  count: number,
): Promise<ReviewedSourcingRequestResult> {
  const operationId = crypto.randomUUID();
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
    return {
      ok: false,
      error:
        typeof code === "string" && SAFE_SOURCING_ERRORS[code]
          ? SAFE_SOURCING_ERRORS[code]
          : "The sourcing agent is unavailable.",
    };
  }

  const parsed = parseSourcingAgentSuccessResponse(
    body,
    campaignId,
    count,
  );
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, error: "The sourcing agent returned an invalid result." };
}
