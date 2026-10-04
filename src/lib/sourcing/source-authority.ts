import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { ApolloPerson, ApolloSearchProfile } from "@/lib/sourcing/apollo";

type Scope = "email";

export type ApolloPrepareResult =
  | { status: "prepared"; confirmationNonce: string; expiresAt: string }
  | { status: "not_found" | "dependency_unavailable" };

export type ApolloClaimResult =
  | { status: "claimed"; attemptId: string; providerExternalId: string }
  | { status: "completed"; found: boolean; emailSecret: string; phoneSecret: string }
  | {
      status:
        | "not_found"
        | "in_progress"
        | "ambiguous"
        | "nonce_invalid"
        | "quota_exceeded"
        | "idempotency_conflict"
        | "cancelled"
        | "dependency_unavailable";
    };

type AuthorityContext = {
  workspaceId: string;
  userId: string;
};

type PrepareInput = AuthorityContext & {
  campaignId: string;
  candidateId: string;
  targetId: string;
  scope: Scope;
};

type ClaimInput = PrepareInput & {
  confirmationNonce: string;
  idempotencyKey: string;
  requestId: string;
};

type CompleteInput = AuthorityContext & {
  targetId: string;
  attemptId: string;
  found: boolean;
  emailSecret: string;
  phoneSecret: string;
};

type AmbiguousInput = AuthorityContext & {
  targetId: string;
  attemptId: string;
};

export type ApolloReconciliationItem = {
  attemptId: string;
  targetId: string;
  providerExternalId: string;
  requesterId: string;
  status: "in_progress" | "ambiguous";
  version: number;
  requestId: string;
  createdAt: string;
  leaseExpiresAt: string;
  ambiguousAt: string | null;
};

type ReconcileInput = AuthorityContext & {
  attemptId: string;
  expectedVersion: number;
  action: "quarantine_stale" | "complete_found" | "complete_not_found" | "release_no_charge";
  emailSecret: string;
  caseReference: string;
  evidenceSha256: string;
  requestId: string;
};

export type ApolloReconcileResult =
  | {
      status: "reconciled";
      attemptId: string;
      attemptStatus: "ambiguous" | "completed" | "cancelled";
      version: number;
      eventId: string;
    }
  | { status: "not_found" | "conflict" | "not_stale" | "dependency_unavailable" };

type EraseInput = AuthorityContext & {
  campaignId: string;
  candidateId: string;
  targetId: string;
  caseReference: string;
  requestId: string;
};

export type ApolloErasureResult =
  | {
      status: "erased";
      targetId: string;
      clearedReceipts: number;
      cancelledAttempts: number;
      eventId: string | null;
    }
  | { status: "not_found" | "dependency_unavailable" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boundedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : "";
}

function uuid(value: unknown): string {
  const candidate = string(value);
  return UUID_RE.test(candidate) ? candidate : "";
}

function canonicalIsoDate(value: unknown): string {
  const candidate = string(value);
  if (!candidate || candidate.length > 100) return "";
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString();
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

function serviceClient() {
  return getServiceSupabase();
}

export async function registerApolloEnrichmentTargets(
  context: AuthorityContext & { campaignId: string },
  people: ApolloPerson[],
): Promise<ApolloSearchProfile[] | null> {
  if (people.length === 0) return [];
  const service = serviceClient();
  if (!service) return null;

  const providerProfiles = people
    .filter((person) => boundedString(person.id, 200))
    .map((person) => ({
      providerExternalId: person.id.trim(),
      profile: {
        name: person.name,
        title: person.title,
        company: person.company,
        linkedinUrl: person.linkedinUrl,
        city: person.city,
        state: person.state,
        country: person.country,
        headline: person.headline,
        seniority: person.seniority,
        departments: person.departments,
      },
    }));
  if (providerProfiles.length !== people.length) return null;

  const { data, error } = await service.rpc("register_apollo_enrichment_targets", {
    p_workspace_id: context.workspaceId,
    p_user_id: context.userId,
    p_campaign_id: context.campaignId,
    p_profiles: providerProfiles,
  });
  if (error || !Array.isArray(data)) return null;

  const authorityByProviderId = new Map<
    string,
    { targetId: string; candidateId: string }
  >();
  for (const item of data) {
    const row = record(item);
    const providerExternalId = boundedString(row?.provider_external_id, 200);
    const targetId = uuid(row?.target_id);
    const candidateId = uuid(row?.candidate_id);
    if (!providerExternalId || !targetId || !candidateId) return null;
    authorityByProviderId.set(providerExternalId, { targetId, candidateId });
  }

  const profiles: ApolloSearchProfile[] = [];
  for (const person of people) {
    const authority = authorityByProviderId.get(person.id.trim());
    if (!authority) return null;
    const { id: _providerExternalId, ...profile } = person;
    profiles.push({ ...profile, ...authority });
  }
  return profiles;
}

export async function selectApolloEnrichmentTargets(
  context: AuthorityContext & { campaignId: string },
  bindings: Array<{ targetId: string; candidateId: string }>,
): Promise<boolean> {
  if (bindings.length < 1 || bindings.length > 50) return false;
  const service = serviceClient();
  if (!service) return false;
  for (const binding of bindings) {
    const { data, error } = await service.rpc("select_apollo_enrichment_target", {
      p_workspace_id: context.workspaceId,
      p_user_id: context.userId,
      p_campaign_id: context.campaignId,
      p_target_id: binding.targetId,
      p_candidate_id: binding.candidateId,
    });
    if (error || record(data)?.ok !== true) return false;
  }
  return true;
}

export async function prepareApolloEnrichmentTarget(
  input: PrepareInput,
): Promise<ApolloPrepareResult> {
  const service = serviceClient();
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("prepare_apollo_enrichment", {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_campaign_id: input.campaignId,
    p_candidate_id: input.candidateId,
    p_target_id: input.targetId,
    p_scope: input.scope,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "prepared") {
    const confirmationNonce = uuid(result.confirmation_nonce);
    const expiresAt = canonicalIsoDate(result.expires_at);
    if (confirmationNonce && expiresAt) {
      return { status: "prepared", confirmationNonce, expiresAt };
    }
  }
  if (result?.status === "not_found") return { status: "not_found" };
  return { status: "dependency_unavailable" };
}

export async function claimApolloEnrichmentTarget(
  input: ClaimInput,
): Promise<ApolloClaimResult> {
  const service = serviceClient();
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("claim_apollo_enrichment", {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_campaign_id: input.campaignId,
    p_candidate_id: input.candidateId,
    p_target_id: input.targetId,
    p_scope: input.scope,
    p_confirmation_nonce: input.confirmationNonce,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "claimed") {
    const attemptId = uuid(result.attempt_id);
    const providerExternalId = boundedString(result.provider_external_id, 200);
    return attemptId && providerExternalId
      ? { status: "claimed", attemptId, providerExternalId }
      : { status: "dependency_unavailable" };
  }
  if (result?.status === "completed") {
    if (typeof result.found !== "boolean") return { status: "dependency_unavailable" };
    const emailSecret = string(result.email_secret);
    const phoneSecret = string(result.phone_secret);
    if (
      emailSecret.length > 4096 ||
      phoneSecret !== "" ||
      (result.found && !emailSecret) ||
      (!result.found && emailSecret !== "")
    ) {
      return { status: "dependency_unavailable" };
    }
    return {
      status: "completed",
      found: result.found,
      emailSecret,
      phoneSecret,
    };
  }
  const status = result?.status;
  if (
    status === "not_found" ||
    status === "in_progress" ||
    status === "ambiguous" ||
    status === "nonce_invalid" ||
    status === "quota_exceeded" ||
    status === "idempotency_conflict" ||
    status === "cancelled"
  ) {
    return { status };
  }
  return { status: "dependency_unavailable" };
}

export async function completeApolloEnrichmentTarget(
  input: CompleteInput,
): Promise<boolean> {
  const service = serviceClient();
  if (!service) return false;
  const { data, error } = await service.rpc("complete_apollo_enrichment", {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_target_id: input.targetId,
    p_attempt_id: input.attemptId,
    p_found: input.found,
    p_email_secret: input.emailSecret,
    p_phone_secret: input.phoneSecret,
  });
  return !error && record(data)?.ok === true;
}

export async function markApolloEnrichmentAmbiguous(
  input: AmbiguousInput,
): Promise<boolean> {
  const service = serviceClient();
  if (!service) return false;
  const { data, error } = await service.rpc("mark_apollo_enrichment_ambiguous", {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_target_id: input.targetId,
    p_attempt_id: input.attemptId,
  });
  return !error && record(data)?.ok === true;
}

export async function listApolloEnrichmentReconciliation(
  context: AuthorityContext,
  input: { beforeCreated: string | null; beforeId: string | null; limit: number },
): Promise<ApolloReconciliationItem[] | null> {
  const service = serviceClient();
  if (!service) return null;
  const { data, error } = await service.rpc("list_apollo_enrichment_reconciliation", {
    p_workspace_id: context.workspaceId,
    p_actor_id: context.userId,
    p_before_created: input.beforeCreated,
    p_before_id: input.beforeId,
    p_limit: input.limit,
  });
  if (error || !Array.isArray(data)) return null;

  const items: ApolloReconciliationItem[] = [];
  for (const value of data) {
    const row = record(value);
    const attemptId = uuid(row?.attempt_id);
    const targetId = uuid(row?.target_id);
    const providerExternalId = boundedString(row?.provider_external_id, 200);
    const requesterId = uuid(row?.requester_id);
    const status = row?.status;
    const version = positiveInteger(row?.version);
    const requestId = boundedString(row?.request_id, 100);
    const createdAt = canonicalIsoDate(row?.created_at);
    const leaseExpiresAt = canonicalIsoDate(row?.lease_expires_at);
    const ambiguousAt = row?.ambiguous_at === null ? null : canonicalIsoDate(row?.ambiguous_at);
    if (
      !attemptId ||
      !targetId ||
      !providerExternalId ||
      !requesterId ||
      (status !== "in_progress" && status !== "ambiguous") ||
      !version ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(requestId) ||
      !createdAt ||
      !leaseExpiresAt ||
      (row?.ambiguous_at !== null && !ambiguousAt)
    ) {
      return null;
    }
    items.push({
      attemptId,
      targetId,
      providerExternalId,
      requesterId,
      status,
      version,
      requestId,
      createdAt,
      leaseExpiresAt,
      ambiguousAt,
    });
  }
  return items;
}

export async function reconcileApolloEnrichment(
  input: ReconcileInput,
): Promise<ApolloReconcileResult> {
  const service = serviceClient();
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("reconcile_apollo_enrichment", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.userId,
    p_attempt_id: input.attemptId,
    p_expected_version: input.expectedVersion,
    p_action: input.action,
    p_email_secret: input.emailSecret,
    p_case_reference: input.caseReference,
    p_evidence_sha256: input.evidenceSha256,
    p_request_id: input.requestId,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "reconciled") {
    const attemptId = uuid(result.attempt_id);
    const eventId = uuid(result.event_id);
    const attemptStatus = result.attempt_status;
    const version = positiveInteger(result.version);
    if (
      attemptId &&
      eventId &&
      (attemptStatus === "ambiguous" || attemptStatus === "completed" || attemptStatus === "cancelled") &&
      version
    ) {
      return { status: "reconciled", attemptId, attemptStatus, version, eventId };
    }
    return { status: "dependency_unavailable" };
  }
  if (result?.status === "not_found" || result?.status === "conflict" || result?.status === "not_stale") {
    return { status: result.status };
  }
  return { status: "dependency_unavailable" };
}

export async function eraseApolloEnrichmentTarget(
  input: EraseInput,
): Promise<ApolloErasureResult> {
  const service = serviceClient();
  if (!service) return { status: "dependency_unavailable" };
  const { data, error } = await service.rpc("erase_apollo_enrichment_target", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.userId,
    p_campaign_id: input.campaignId,
    p_candidate_id: input.candidateId,
    p_target_id: input.targetId,
    p_case_reference: input.caseReference,
    p_request_id: input.requestId,
  });
  if (error) return { status: "dependency_unavailable" };
  const result = record(data);
  if (result?.status === "not_found") return { status: "not_found" };
  if (result?.status === "already_erased") {
    const targetId = uuid(result.target_id);
    const eventId = uuid(result.original_event_id);
    return targetId === input.targetId && eventId
      ? {
          status: "erased",
          targetId,
          clearedReceipts: 0,
          cancelledAttempts: 0,
          eventId,
        }
      : { status: "dependency_unavailable" };
  }
  if (result?.status !== "erased") return { status: "dependency_unavailable" };

  const targetId = uuid(result.target_id);
  const clearedReceipts = nonNegativeInteger(result.cleared_receipts);
  const cancelledAttempts = nonNegativeInteger(result.cancelled_attempts);
  const eventId = uuid(result.event_id);
  if (
    targetId !== input.targetId ||
    clearedReceipts < 0 ||
    cancelledAttempts < 0 ||
    !eventId
  ) {
    return { status: "dependency_unavailable" };
  }
  return { status: "erased", targetId, clearedReceipts, cancelledAttempts, eventId };
}
