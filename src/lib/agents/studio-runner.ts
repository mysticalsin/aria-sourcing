import {
  AgentFrameworkRunSuccessResponseSchema,
  normalizeAgentRoleTitle,
} from "@/lib/agents/framework/contracts";
import { campaignAllowsLiveSourcing } from "@/lib/sourcing/campaign-lifecycle";
import type { SourceNextBatchResult } from "@/lib/store/contracts";
import type { CampaignStatus, Candidate } from "@/lib/types";
import { z } from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 64_000;

interface CampaignChoice {
  id: string;
  status: CampaignStatus;
  jobAnalysis: { title: string };
}

export type StudioCampaignResolution =
  | { ok: true; campaignId: string }
  | { ok: false; reason: string };

export type StudioAgentRunResult =
  | {
      ok: true;
      runId: string;
      accepted: number;
      skipped: number;
      source: "github" | "web" | "mock";
      reports: string[];
      candidates: Candidate[];
    }
  | {
      ok: false;
      error: string;
      retryable?: "agent_framework_reconcile";
    };

export interface StudioRunIdempotencyScope {
  specId: string;
  workflowVersionId: string;
  campaignId: string;
}

export interface StudioRunRetryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STUDIO_RUN_RETRY_STORAGE_PREFIX = "aria:studio-agent-run:v1:";

const RuntimeEligibleAgentSpecSchema = z.object({
  id: z.string().uuid(),
  role_brief: z.object({
    title: z.string().trim().min(1).max(120),
  }).passthrough(),
  runtime_eligible: z.boolean(),
  runtime_reason: z.string().max(500).nullable(),
  workflowVersionId: z.string().uuid().nullable(),
  workflowName: z.string().trim().min(1).max(120).nullable().optional(),
  workflowSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
}).passthrough();

const AgentSpecListResponseSchema = z.object({
  ok: z.literal(true),
  specs: z.array(RuntimeEligibleAgentSpecSchema).max(500),
}).passthrough();

export type RuntimeEligibleAgentSpec = z.infer<typeof RuntimeEligibleAgentSpecSchema>;

export type CampaignAgentFrameworkResolution =
  | { ok: true; spec: RuntimeEligibleAgentSpec & { workflowVersionId: string; workflowSha256: string } }
  | { ok: false; error: string };

export type PrimaryAgentSourcingResult =
  | {
      ok: true;
      mode: "framework" | "demo";
      candidates: Candidate[];
      skipped: number;
      source: "github" | "web" | "mock";
      reports: string[];
    }
  | {
      ok: false;
      error: string;
      retryable?: "agent_framework_reconcile";
    };

function studioRunRetryStorageKey(scope: StudioRunIdempotencyScope): string {
  return `${STUDIO_RUN_RETRY_STORAGE_PREFIX}${[
    scope.specId,
    scope.workflowVersionId,
    scope.campaignId,
  ].map(encodeURIComponent).join(":")}`;
}

/** Keeps only the non-secret browser request UUID. Framework capability tokens
 * remain response-local and are never written to memory or session storage. */
export function acquireStudioRunIdempotencyKey(
  scope: StudioRunIdempotencyScope,
  memory: Map<string, string>,
  storage: StudioRunRetryStorage | null,
  createUuid: () => string = () => globalThis.crypto.randomUUID(),
): string {
  const storageKey = studioRunRetryStorageKey(scope);
  const inMemory = memory.get(storageKey);
  if (inMemory && UUID_RE.test(inMemory)) return inMemory;

  let stored: string | null = null;
  try {
    stored = storage?.getItem(storageKey) ?? null;
  } catch {
    stored = null;
  }
  if (stored && UUID_RE.test(stored)) {
    memory.set(storageKey, stored);
    return stored;
  }

  const created = createUuid();
  if (!UUID_RE.test(created)) {
    throw new Error("The Studio run idempotency key generator returned an invalid UUID.");
  }
  memory.set(storageKey, created);
  try {
    storage?.setItem(storageKey, created);
  } catch {
    // In-memory reuse still protects retries in this mounted Studio session.
  }
  return created;
}

export function settleStudioRunIdempotencyKey(
  scope: StudioRunIdempotencyScope,
  result: StudioAgentRunResult,
  memory: Map<string, string>,
  storage: StudioRunRetryStorage | null,
): void {
  if (!result.ok && result.retryable === "agent_framework_reconcile") return;
  const storageKey = studioRunRetryStorageKey(scope);
  memory.delete(storageKey);
  try {
    storage?.removeItem(storageKey);
  } catch {
    // The in-memory key is already cleared. Storage denial is non-fatal.
  }
}

/** A stored spec never creates or guesses a recruiting need. It may run only
 * when exactly one sourceable campaign has the same reviewed role title. */
export function resolveStudioCampaign(
  specTitle: string,
  campaigns: readonly CampaignChoice[],
): StudioCampaignResolution {
  const expected = normalizeAgentRoleTitle(specTitle);
  const compatible = campaigns.filter(
    (campaign) =>
      campaignAllowsLiveSourcing(campaign.status) &&
      normalizeAgentRoleTitle(campaign.jobAnalysis.title) === expected,
  );
  if (compatible.length === 0) {
    return { ok: false, reason: "No active campaign has this exact reviewed role title." };
  }
  if (compatible.length !== 1) {
    return {
      ok: false,
      reason: "More than one active campaign has this role title. Open the campaign you intend to source before running the agent.",
    };
  }
  return { ok: true, campaignId: compatible[0].id };
}

/** Selects one server-declared runtime-eligible spec for an already selected
 * campaign. The campaign title is reviewed product state; no need or workflow
 * is inferred in the browser. */
export function resolveCampaignAgentFrameworkSpec(
  campaignTitle: string,
  specs: readonly RuntimeEligibleAgentSpec[],
): CampaignAgentFrameworkResolution {
  const expectedTitle = normalizeAgentRoleTitle(campaignTitle);
  const matches = specs.filter((spec) =>
    spec.runtime_eligible &&
    typeof spec.workflowVersionId === "string" &&
    typeof spec.workflowSha256 === "string" &&
    normalizeAgentRoleTitle(spec.role_brief.title) === expectedTitle
  );

  if (matches.length === 0) {
    return {
      ok: false,
      error: "No runtime-eligible approved agent matches this campaign's exact reviewed role title.",
    };
  }
  if (matches.length !== 1) {
    return {
      ok: false,
      error: "More than one runtime-eligible approved agent matches this campaign. Resolve the duplicate approvals in Agent Studio before running Aria.",
    };
  }

  return {
    ok: true,
    spec: matches[0] as RuntimeEligibleAgentSpec & {
      workflowVersionId: string;
      workflowSha256: string;
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function loadCampaignAgentFrameworkSpec(input: {
  campaignTitle: string;
  fetcher?: typeof fetch;
}): Promise<CampaignAgentFrameworkResolution> {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)("/api/agents/specs", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return {
      ok: false,
      error: "The approved agent framework is unavailable. No sourcing was started.",
    };
  }

  const raw = await readBoundedJson(response);
  const parsed = AgentSpecListResponseSchema.safeParse(raw);
  if (!response.ok || !parsed.success) {
    return {
      ok: false,
      error: "The approved agent framework is unavailable. No sourcing was started.",
    };
  }
  return resolveCampaignAgentFrameworkSpec(input.campaignTitle, parsed.data.specs);
}

export async function executeStudioAgentRun(input: {
  specId: string;
  workflowVersionId: string;
  campaignId: string;
  count: number;
  idempotencyKey: string;
  fetcher?: typeof fetch;
  sourceNextBatch: (
    campaignId: string,
    options: {
      count: number;
      agentFramework: { runId: string; capabilityToken: string; query: string };
    },
  ) => Promise<SourceNextBatchResult>;
}): Promise<StudioAgentRunResult> {
  if (
    !UUID_RE.test(input.specId) ||
    !UUID_RE.test(input.workflowVersionId) ||
    !UUID_RE.test(input.idempotencyKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.campaignId) ||
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > 8
  ) {
    return { ok: false, error: "The agent run request is invalid." };
  }

  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)("/api/agents/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        campaignId: input.campaignId,
        specId: input.specId,
        workflowVersionId: input.workflowVersionId,
        count: input.count,
      }),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, error: "The agent framework is unavailable. No sourcing was started." };
  }

  const raw = await readBoundedJson(response);
  const parsed = AgentFrameworkRunSuccessResponseSchema.safeParse(raw);
  if (!response.ok || !parsed.success) {
    return { ok: false, error: "The agent framework did not authorize this sourcing run." };
  }
  if (
    parsed.data.command.campaignId !== input.campaignId ||
    parsed.data.command.count !== input.count
  ) {
    return { ok: false, error: "The agent framework returned a mismatched sourcing command." };
  }

  let sourced: SourceNextBatchResult;
  try {
    sourced = await input.sourceNextBatch(input.campaignId, {
      count: input.count,
      agentFramework: {
        runId: parsed.data.runId,
        capabilityToken: parsed.data.command.capabilityToken,
        query: parsed.data.command.query,
      },
    });
  } catch {
    return { ok: false, error: "Real candidate sourcing failed before results were saved." };
  }
  if (!sourced.ok) {
    return {
      ok: false,
      error: sourced.error,
      ...(sourced.retryable ? { retryable: sourced.retryable } : {}),
    };
  }

  return {
    ok: true,
    runId: parsed.data.runId,
    accepted: sourced.accepted.length,
    skipped: sourced.skipped.length,
    source: sourced.source,
    reports: parsed.data.reports,
    candidates: sourced.accepted,
  };
}

/** The only sourcing entry point used by the primary Run Aria surface.
 * Live workspaces must first resolve and execute one approved Flowise/DeerFlow
 * binding. Synthetic sourcing is reachable only when the caller has already
 * established an explicitly allowed demo deployment. */
export async function executePrimaryAgentSourcing(input: {
  campaignId: string;
  campaignTitle: string;
  count: number;
  demoAuthorized: boolean;
  idempotencyMemory: Map<string, string>;
  retryStorage: StudioRunRetryStorage | null;
  fetcher?: typeof fetch;
  createUuid?: () => string;
  sourceNextBatch: (
    campaignId: string,
    options: {
      count: number;
      platform?: "Talent Pool";
      agentFramework?: { runId: string; capabilityToken: string; query: string };
    },
  ) => Promise<SourceNextBatchResult>;
}): Promise<PrimaryAgentSourcingResult> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.campaignId) ||
    !input.campaignTitle.trim() ||
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > 8
  ) {
    return { ok: false, error: "The agent run request is invalid." };
  }

  if (input.demoAuthorized) {
    let sourced: SourceNextBatchResult;
    try {
      sourced = await input.sourceNextBatch(input.campaignId, {
        count: input.count,
        platform: "Talent Pool",
      });
    } catch {
      return { ok: false, error: "Demo sourcing failed unexpectedly." };
    }
    if (!sourced.ok) return { ok: false, error: sourced.error };
    return {
      ok: true,
      mode: "demo",
      candidates: sourced.accepted,
      skipped: sourced.skipped.length,
      source: sourced.source,
      reports: [],
    };
  }

  const selected = await loadCampaignAgentFrameworkSpec({
    campaignTitle: input.campaignTitle,
    fetcher: input.fetcher,
  });
  if (!selected.ok) return selected;

  const scope = {
    specId: selected.spec.id,
    workflowVersionId: selected.spec.workflowVersionId,
    campaignId: input.campaignId,
  };
  let idempotencyKey: string;
  try {
    idempotencyKey = acquireStudioRunIdempotencyKey(
      scope,
      input.idempotencyMemory,
      input.retryStorage,
      input.createUuid,
    );
  } catch {
    return { ok: false, error: "The agent run could not create a safe retry key." };
  }

  const result = await executeStudioAgentRun({
    specId: selected.spec.id,
    workflowVersionId: selected.spec.workflowVersionId,
    campaignId: input.campaignId,
    count: input.count,
    idempotencyKey,
    fetcher: input.fetcher,
    sourceNextBatch: input.sourceNextBatch,
  });
  settleStudioRunIdempotencyKey(
    scope,
    result,
    input.idempotencyMemory,
    input.retryStorage,
  );
  if (!result.ok) return result;

  return {
    ok: true,
    mode: "framework",
    candidates: result.candidates,
    skipped: result.skipped,
    source: result.source,
    reports: result.reports,
  };
}
