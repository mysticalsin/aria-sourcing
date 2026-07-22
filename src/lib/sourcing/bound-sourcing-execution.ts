import { z } from "zod";

import {
  DISCLOSURE_SYSTEM,
  candidateDisclosureContextForCampaignLike,
} from "@/lib/agent-disclosure-policy";
import type { ActiveAiRuntimeBinding } from "@/lib/ai/runtime-binding";
import {
  SOURCING_TOOL_DEFS,
  makeSourcingToolRunner,
  type SourcingQueryExecution,
} from "@/lib/ai/sourcing-tools";
import {
  runAnthropicWithTools,
  runOpenAiWithTools,
  type ResolvedMcpServer,
} from "@/lib/ai/tool-loop";
import type { CandidateDedupeIdentity } from "@/lib/rules";
import type { SourcingLearningLesson } from "@/lib/sourcing/learning-authority";
import type { SourcingAgentCampaign } from "@/lib/sourcing/sourcing-agent-contract";
import type { Candidate } from "@/lib/types";

const SYSTEM_PROMPT =
  "You are Aria's autonomous sourcing agent. You have a search_candidates tool that returns real, " +
  "already-scored people found through live search. Never invent a candidate, score, company, or URL. " +
  "Search only relevant platforms and stop when enough strong matches exist. Respond with only strict " +
  "JSON: {\"drafts\":[{\"candidateId\":\"<tool result id>\",\"subject\":\"<email subject>\",\"body\":\"<first-touch outreach under 120 words>\"}]}. " +
  "Every candidateId must come from a tool result. Drafts lead with specific verified work, give one " +
  "genuine reason for contact, use a low-pressure ask, and contain no fabricated facts. " +
  DISCLOSURE_SYSTEM;

const DraftSchema = z
  .object({
    candidateId: z.string().min(1).max(100),
    subject: z.string().trim().min(1).max(255),
    body: z.string().trim().min(1).max(5_000),
  })
  .strict();

export interface BoundSourcingDraft {
  candidateId: string;
  subject: string;
  body: string;
}

export interface BoundSourcingPipelineDependencies {
  createToolRunner: typeof makeSourcingToolRunner;
  runAnthropic: typeof runAnthropicWithTools;
  runOpenAi: typeof runOpenAiWithTools;
}

export interface BoundSourcingPipelineInput {
  workspaceId: string;
  campaign: SourcingAgentCampaign;
  existing: CandidateDedupeIdentity[];
  count: number;
  binding: ActiveAiRuntimeBinding | null;
  apiKey: string;
  githubToken: string;
  tavilyKey?: string | null;
  promotedLessons: SourcingLearningLesson[];
  beforeExternalCall: () => Promise<boolean>;
}

export type BoundSourcingPipelineResult =
  | {
      ok: true;
      found: Candidate[];
      executions: SourcingQueryExecution[];
      drafts: BoundSourcingDraft[];
      durableEvidence: {
        ready: false;
        code: "provider_evidence_unavailable";
      };
    }
  | {
      ok: false;
      code:
        | "not_configured"
        | "authority_changed"
        | "upstream_failed"
        | "no_real_search"
        | "response_invalid";
    };

const DEFAULT_DEPENDENCIES: BoundSourcingPipelineDependencies = {
  createToolRunner: makeSourcingToolRunner,
  runAnthropic: runAnthropicWithTools,
  runOpenAi: runOpenAiWithTools,
};

/**
 * The browser runner currently exposes only bounded query summaries and
 * mapped candidates. It does not retain a provider-response digest, a
 * canonical external identifier for every supported platform, or a durable
 * receipt that a database commit can validate. Autonomous callers must stop
 * before egress until those three fields are produced by the source adapter.
 */
export function autonomousSourcingDurableEvidenceCapability() {
  return {
    ready: false,
    code: "provider_evidence_unavailable",
    missing: [
      "provider_response_sha256",
      "canonical_source_external_id",
      "durable_query_receipt",
    ],
  } as const;
}

function buildPrompt(
  campaign: SourcingAgentCampaign,
  count: number,
  lessons: SourcingLearningLesson[],
): string {
  const promotedQueries = lessons.length
    ? [
        "Human-promoted search lessons for this exact role are optional suggestions:",
        ...lessons.map((lesson) => `- ${lesson.platform}: ${lesson.query}`),
        "Use a suggestion only when it remains relevant. The search tool policy is authoritative.",
      ]
    : [];
  return [
    candidateDisclosureContextForCampaignLike(campaign),
    "",
    `Find and draft outreach for ${count} real candidates for this role.`,
    ...promotedQueries,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseDrafts(
  text: string,
  maxCount: number,
  observedCandidateIds: ReadonlySet<string>,
): BoundSourcingDraft[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text.trim());
  } catch {
    return null;
  }
  const parsed = z
    .object({ drafts: z.array(DraftSchema).max(maxCount) })
    .strict()
    .safeParse(json);
  if (!parsed.success) return null;
  const ids = new Set<string>();
  for (const draft of parsed.data.drafts) {
    if (ids.has(draft.candidateId) || !observedCandidateIds.has(draft.candidateId)) return null;
    if (draft.body.split(/\s+/).filter(Boolean).length > 120) return null;
    if (/[\u0000-\u001f\u007f]/.test(draft.subject)) return null;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(draft.body)) return null;
    ids.add(draft.candidateId);
  }
  return parsed.data.drafts;
}

function usableProviderKey(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 8_192 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

async function authorityStillValid(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

/**
 * Execute the existing real-provider sourcing pipeline using only an already
 * validated, workspace-bound database binding and secret. This module does
 * not grant authority and does not persist candidates. Callers must surround
 * it with their own durable begin/check/commit authority.
 */
export async function executeBoundSourcingPipeline(
  input: BoundSourcingPipelineInput,
  dependencies: BoundSourcingPipelineDependencies = DEFAULT_DEPENDENCIES,
): Promise<BoundSourcingPipelineResult> {
  const { binding } = input;
  if (
    !binding ||
    !z.string().uuid().safeParse(input.workspaceId).success ||
    binding.workspaceId !== input.workspaceId ||
    binding.purpose !== "sourcing" ||
    !usableProviderKey(input.apiKey) ||
    !Number.isSafeInteger(input.count) ||
    input.count < 1 ||
    input.count > 8
  ) {
    return { ok: false, code: "not_configured" };
  }
  if (!(await authorityStillValid(input.beforeExternalCall))) {
    return { ok: false, code: "authority_changed" };
  }

  const runner = dependencies.createToolRunner(
    input.campaign,
    input.existing,
    input.campaign.scoringWeights,
    input.githubToken,
    input.tavilyKey ?? null,
    undefined,
    input.beforeExternalCall,
  );
  const servers: ResolvedMcpServer[] = [
    {
      url: "builtin:sourcing-agent",
      token: "",
      tools: SOURCING_TOOL_DEFS,
      run: runner.run,
    },
  ];
  const prompt = buildPrompt(input.campaign, input.count, input.promotedLessons);
  let result: Awaited<ReturnType<typeof runOpenAiWithTools>>;
  try {
    result = binding.provider === "anthropic"
      ? await dependencies.runAnthropic({
          model: binding.model,
          system: SYSTEM_PROMPT,
          prompt,
          key: input.apiKey,
          servers,
          maxRounds: 6,
          beforeExternalCall: input.beforeExternalCall,
        })
      : await dependencies.runOpenAi({
          provider: binding.provider,
          model: binding.model,
          system: SYSTEM_PROMPT,
          prompt,
          key: input.apiKey,
          servers,
          maxRounds: 6,
          beforeExternalCall: input.beforeExternalCall,
        });
  } catch {
    return !(await authorityStillValid(input.beforeExternalCall))
      ? { ok: false, code: "authority_changed" }
      : { ok: false, code: "upstream_failed" };
  }

  if (!result.ok) {
    return !(await authorityStillValid(input.beforeExternalCall))
      ? { ok: false, code: "authority_changed" }
      : { ok: false, code: "upstream_failed" };
  }
  // A provider can return a syntactically successful response after authority
  // was revoked while that call was in flight. Recheck before interpreting
  // tool results so revocation cannot be misclassified as an upstream or
  // no-search failure and cannot flow into candidate projection.
  if (!(await authorityStillValid(input.beforeExternalCall))) {
    return { ok: false, code: "authority_changed" };
  }
  const executions = runner.getExecutions();
  if (executions.length === 0 || !executions.some((execution) => execution.ok)) {
    return { ok: false, code: "no_real_search" };
  }
  const found = runner.getFound();
  const drafts = parseDrafts(
    result.text ?? "",
    input.count,
    new Set(found.map((candidate) => candidate.id)),
  );
  if (!drafts) return { ok: false, code: "response_invalid" };
  return {
    ok: true,
    found,
    executions,
    drafts,
    durableEvidence: {
      ready: false,
      code: "provider_evidence_unavailable",
    },
  };
}
