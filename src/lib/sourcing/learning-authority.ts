import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { SourcingQueryExecution } from "@/lib/ai/sourcing-tools";
import type { SourcePlatform } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ROLE_FINGERPRINT_RE = SHA256_RE;
const LEARNING_PLATFORMS = [
  "GitHub",
  "LinkedIn",
  "Stack Overflow",
  "Dribbble",
  "Behance",
] as const satisfies readonly SourcePlatform[];

type LearningPlatform = (typeof LEARNING_PLATFORMS)[number];
type ServiceClient = NonNullable<ReturnType<typeof getServiceSupabase>>;

export interface SourcingRoleBasis {
  title: string;
  seniority?: string;
  employmentType?: string;
  locationType?: string;
  region?: string;
  timezone?: string;
  skills: string[];
}

export interface SourcingLearningLesson {
  lessonId: string;
  platform: LearningPlatform;
  query: string;
  graphifyClusterRef: string;
  graphifyClusterRank: number;
  evidenceRunCount: number;
  evidenceCampaignCount: number;
  usefulFeedbackCount: number;
  expiresAt: string;
  rank: number;
}

export interface SourcingFeedbackReceipt {
  receiptId: string;
  platform: LearningPlatform;
  candidateCount: number;
}

export type ListPendingSourcingFeedbackResult =
  | { status: "ready"; receipts: SourcingFeedbackReceipt[] }
  | { status: "learning_disabled"; receipts: [] }
  | { status: "invalid_request" | "not_found" | "dependency_unavailable" };

export type BeginSourcingRunResult =
  | {
      status: "claimed";
      runId: string;
      roleFingerprint: string;
      lessonsEnabled: boolean;
    }
  | {
      status: "in_progress" | "completed" | "failed";
      runId: string;
      roleFingerprint: string;
    }
  | {
      status:
        | "quota_exceeded"
        | "idempotency_conflict"
        | "invalid_request"
        | "not_found"
        | "dependency_unavailable";
    };

export type ListSourcingLessonsResult =
  | {
      status: "ready";
      roleFingerprint: string;
      lessons: SourcingLearningLesson[];
    }
  | { status: "learning_disabled"; lessons: [] }
  | { status: "invalid_request" | "not_found" | "dependency_unavailable" };

export type CompleteSourcingRunResult =
  | {
      status: "completed";
      runId: string;
      queryCount: number;
      candidateCount: number;
      receipts: SourcingFeedbackReceipt[];
    }
  | {
      status:
        | "invalid_receipts"
        | "not_found"
        | "completion_conflict"
        | "dependency_unavailable";
    };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uuid(value: unknown): string {
  return typeof value === "string" && UUID_RE.test(value) ? value : "";
}

function fingerprint(value: unknown): string {
  return typeof value === "string" && ROLE_FINGERPRINT_RE.test(value) ? value : "";
}

function nonNegativeInteger(value: unknown, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max
    ? value
    : -1;
}

function positiveInteger(value: unknown, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max
    ? value
    : 0;
}

function isoDate(value: unknown): string {
  if (typeof value !== "string" || value.length > 100) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function platform(value: unknown): LearningPlatform | null {
  return LEARNING_PLATFORMS.includes(value as LearningPlatform)
    ? (value as LearningPlatform)
    : null;
}

function client(serviceClient?: ServiceClient | null): ServiceClient | null {
  return serviceClient === undefined ? getServiceSupabase() : serviceClient;
}

export async function beginSourcingRun(
  input: {
    workspaceId: string;
    actorId: string;
    campaignId: string;
    roleBasis: SourcingRoleBasis;
    configurationFingerprint: string;
    mode: "cloud" | "deterministic";
    provider: string | null;
    model: string | null;
    idempotencyKey: string;
    requestId: string;
  },
  serviceClient?: ServiceClient | null,
): Promise<BeginSourcingRunResult> {
  if (!SHA256_RE.test(input.configurationFingerprint)) {
    return { status: "invalid_request" };
  }
  const service = client(serviceClient);
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("begin_sourcing_run", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_campaign_id: input.campaignId,
    p_role_basis: input.roleBasis,
    p_configuration_fingerprint: input.configurationFingerprint,
    p_mode: input.mode,
    p_provider: input.provider,
    p_model: input.model,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (!result) return { status: "dependency_unavailable" };
  const status = result?.status;
  if (status === "claimed") {
    const runId = uuid(result.run_id);
    const roleFingerprint = fingerprint(result.role_fingerprint);
    return runId && roleFingerprint && typeof result.lessons_enabled === "boolean"
      ? {
          status,
          runId,
          roleFingerprint,
          lessonsEnabled: result.lessons_enabled,
        }
      : { status: "dependency_unavailable" };
  }
  if (status === "in_progress" || status === "completed" || status === "failed") {
    const runId = uuid(result.run_id);
    const roleFingerprint = fingerprint(result.role_fingerprint);
    return runId && roleFingerprint
      ? { status, runId, roleFingerprint }
      : { status: "dependency_unavailable" };
  }
  if (
    status === "quota_exceeded" ||
    status === "idempotency_conflict" ||
    status === "invalid_request" ||
    status === "not_found"
  ) {
    return { status };
  }
  return { status: "dependency_unavailable" };
}

export async function listPromotedSourcingLessons(
  input: {
    workspaceId: string;
    actorId: string;
    roleBasis: SourcingRoleBasis;
    limit: number;
  },
  serviceClient?: ServiceClient | null,
): Promise<ListSourcingLessonsResult> {
  const service = client(serviceClient);
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("list_promoted_sourcing_lessons", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_role_basis: input.roleBasis,
    p_limit: input.limit,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "learning_disabled") {
    return Array.isArray(result.lessons) && result.lessons.length === 0
      ? { status: "learning_disabled", lessons: [] }
      : { status: "dependency_unavailable" };
  }
  if (result?.status === "invalid_request" || result?.status === "not_found") {
    return { status: result.status };
  }
  if (result?.status !== "ready" || !Array.isArray(result.lessons)) {
    return { status: "dependency_unavailable" };
  }
  const roleFingerprint = fingerprint(result.role_fingerprint);
  if (!roleFingerprint || result.lessons.length > input.limit) {
    return { status: "dependency_unavailable" };
  }
  const lessons: SourcingLearningLesson[] = [];
  for (const value of result.lessons) {
    const row = record(value);
    const lessonId = uuid(row?.lessonId);
    const sourcePlatform = platform(row?.platform);
    const query = typeof row?.query === "string" ? row.query.trim() : "";
    const graphifyClusterRef =
      typeof row?.graphifyClusterRef === "string" &&
      /^[A-Za-z0-9._:-]{1,100}$/.test(row.graphifyClusterRef)
        ? row.graphifyClusterRef
        : "";
    const graphifyClusterRank = positiveInteger(row?.graphifyClusterRank, 1_000_000);
    const evidenceRunCount = nonNegativeInteger(row?.evidenceRunCount, 1_000_000);
    const evidenceCampaignCount = nonNegativeInteger(row?.evidenceCampaignCount, 1_000_000);
    const usefulFeedbackCount = nonNegativeInteger(row?.usefulFeedbackCount, 1_000_000);
    const expiresAt = isoDate(row?.expiresAt);
    const rank = positiveInteger(row?.rank, input.limit);
    if (
      !lessonId ||
      !sourcePlatform ||
      !graphifyClusterRef ||
      !graphifyClusterRank ||
      query.length < 3 ||
      query.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(query) ||
      evidenceRunCount < 0 ||
      evidenceCampaignCount < 0 ||
      usefulFeedbackCount < 0 ||
      !expiresAt ||
      !rank
    ) {
      return { status: "dependency_unavailable" };
    }
    lessons.push({
      lessonId,
      platform: sourcePlatform,
      query,
      graphifyClusterRef,
      graphifyClusterRank,
      evidenceRunCount,
      evidenceCampaignCount,
      usefulFeedbackCount,
      expiresAt,
      rank,
    });
  }
  return { status: "ready", roleFingerprint, lessons };
}

export async function listPendingSourcingFeedback(
  input: {
    workspaceId: string;
    actorId: string;
    campaignId: string;
    limit: number;
  },
  serviceClient?: ServiceClient | null,
): Promise<ListPendingSourcingFeedbackResult> {
  if (
    !input.campaignId ||
    input.campaignId.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(input.campaignId) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 20
  ) {
    return { status: "invalid_request" };
  }
  const service = client(serviceClient);
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("list_pending_sourcing_feedback", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_campaign_id: input.campaignId,
    p_limit: input.limit,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "learning_disabled") {
    return Array.isArray(result.receipts) && result.receipts.length === 0
      ? { status: "learning_disabled", receipts: [] }
      : { status: "dependency_unavailable" };
  }
  if (result?.status === "invalid_request" || result?.status === "not_found") {
    return { status: result.status };
  }
  if (result?.status !== "ready" || !Array.isArray(result.receipts) || result.receipts.length > input.limit) {
    return { status: "dependency_unavailable" };
  }
  const receipts: SourcingFeedbackReceipt[] = [];
  const seen = new Set<string>();
  for (const value of result.receipts) {
    const row = record(value);
    const receiptId = uuid(row?.receiptId);
    const sourcePlatform = platform(row?.platform);
    const candidateCount = nonNegativeInteger(row?.candidateCount, 100);
    if (!receiptId || seen.has(receiptId) || !sourcePlatform || candidateCount < 0) {
      return { status: "dependency_unavailable" };
    }
    seen.add(receiptId);
    receipts.push({ receiptId, platform: sourcePlatform, candidateCount });
  }
  return { status: "ready", receipts };
}

export async function completeSourcingRun(
  input: {
    workspaceId: string;
    actorId: string;
    runId: string;
    queryReceipts: SourcingQueryExecution[];
  },
  serviceClient?: ServiceClient | null,
): Promise<CompleteSourcingRunResult> {
  const service = client(serviceClient);
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("complete_sourcing_run", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_run_id: input.runId,
    p_query_receipts: input.queryReceipts,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "completed") {
    const runId = uuid(result.run_id);
    const queryCount = positiveInteger(result.query_count, 20);
    const candidateCount = nonNegativeInteger(result.candidate_count, 1_000);
    if (
      !runId ||
      !queryCount ||
      candidateCount < 0 ||
      !Array.isArray(result.receipts) ||
      result.receipts.length !== queryCount
    ) {
      return { status: "dependency_unavailable" };
    }
    const receipts: SourcingFeedbackReceipt[] = [];
    for (const value of result.receipts) {
      const row = record(value);
      const receiptId = uuid(row?.receiptId);
      const sourcePlatform = platform(row?.platform);
      const receiptCandidateCount = nonNegativeInteger(row?.candidateCount, 100);
      if (!receiptId || !sourcePlatform || receiptCandidateCount < 0) {
        return { status: "dependency_unavailable" };
      }
      receipts.push({ receiptId, platform: sourcePlatform, candidateCount: receiptCandidateCount });
    }
    return { status: "completed", runId, queryCount, candidateCount, receipts };
  }
  if (
    result?.status === "invalid_receipts" ||
    result?.status === "not_found" ||
    result?.status === "completion_conflict"
  ) {
    return { status: result.status };
  }
  return { status: "dependency_unavailable" };
}

export async function failSourcingRun(
  input: {
    workspaceId: string;
    actorId: string;
    runId: string;
    errorCode: string;
  },
  serviceClient?: ServiceClient | null,
): Promise<boolean> {
  const service = client(serviceClient);
  if (!service) return false;
  const { data, error } = await service.rpc("fail_sourcing_run", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_run_id: input.runId,
    p_error_code: input.errorCode,
  });
  const result = record(data);
  return !error && result?.status === "failed" && uuid(result.run_id) === input.runId;
}

export async function recordSourcingQueryFeedback(
  input: {
    workspaceId: string;
    actorId: string;
    receiptId: string;
    verdict: "useful" | "dead_end" | "corrected";
    requestId: string;
  },
  serviceClient?: ServiceClient | null,
): Promise<
  | { status: "recorded"; feedbackId: string }
  | {
      status:
        | "invalid_request"
        | "not_found"
        | "idempotency_conflict"
        | "feedback_conflict"
        | "dependency_unavailable";
    }
> {
  const service = client(serviceClient);
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("record_sourcing_query_feedback", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_receipt_id: input.receiptId,
    p_verdict: input.verdict,
    p_request_id: input.requestId,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "recorded") {
    const feedbackId = uuid(result.feedback_id);
    return feedbackId
      ? { status: "recorded", feedbackId }
      : { status: "dependency_unavailable" };
  }
  if (
    result?.status === "invalid_request" ||
    result?.status === "not_found" ||
    result?.status === "idempotency_conflict" ||
    result?.status === "feedback_conflict"
  ) {
    return { status: result.status };
  }
  return { status: "dependency_unavailable" };
}
