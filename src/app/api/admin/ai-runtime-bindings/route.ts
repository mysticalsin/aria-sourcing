import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { classifySameOriginJsonRequest } from "@/lib/api/same-origin-json";
import { validateBody } from "@/lib/api/validate";
import {
  isExecutionCredentialProvider,
  verifyExecutionModelCapability,
  type ExecutionCredentialProvider,
  type ExecutionModelPurpose,
} from "@/lib/ai/provider-key-verification";
import { decryptSecret } from "@/lib/crypto-secrets";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import {
  getServerSupabase,
  getServiceSupabase,
  requireAdmin,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const ProviderSlugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const ModelNameSchema = z.string().trim().min(1).max(200).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value),
  "Control characters are not allowed.",
);
const TimestampSchema = z.string().datetime({ offset: true });

const BindingInputSchema = z.object({
  providerSlug: ProviderSlugSchema,
  modelName: ModelNameSchema,
  apiKeyId: UuidSchema,
}).strict();

const StageSchema = z.object({
  requisitionParse: BindingInputSchema,
  sourcing: BindingInputSchema,
}).strict();

const ActivateSchema = z.object({
  bindingSetId: UuidSchema,
}).strict();

const CatalogRowSchema = z.object({
  provider_slug: ProviderSlugSchema,
  credential_provider: z.string().trim().min(1).max(80),
  endpoint_profile: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
  supports_requisition_parse: z.boolean(),
  supports_sourcing: z.boolean(),
  catalog_revision: z.number().int().min(1).max(32_767),
}).strict();

const KeyRowSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(120),
  provider: z.string().min(1).max(80),
  last4: z.string().min(1).max(16),
  status: z.literal("valid"),
  last_tested_at: TimestampSchema.nullable(),
}).strict();

const BindingSetRowSchema = z.object({
  id: UuidSchema,
  status: z.enum(["active", "staged"]),
  set_sha256: Sha256Schema,
  proposed_by: UuidSchema,
  proposed_at: TimestampSchema,
  activated_at: TimestampSchema.nullable(),
}).strict();

const BindingRowSchema = z.object({
  binding_set_id: UuidSchema,
  purpose: z.enum(["requisition_parse", "sourcing"]),
  provider_slug: ProviderSlugSchema,
  credential_provider: z.string().trim().min(1).max(80),
  endpoint_profile: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
  catalog_revision: z.number().int().min(1).max(32_767),
  model_name: ModelNameSchema,
  api_key_id: UuidSchema,
}).strict();

const MutationReceiptSchema = z.object({
  status: z.string(),
  replay: z.boolean(),
  binding_set_id: UuidSchema,
  set_sha256: Sha256Schema,
  receipt_sha256: Sha256Schema,
}).strict();

const ModelCapabilityKeyRowSchema = z.object({
  id: UuidSchema,
  workspace_id: UuidSchema,
  provider: z.string().trim().min(1).max(80),
  status: z.literal("valid"),
  secret: z.string().min(1).max(32_768),
}).strict();

const ModelEvidenceReceiptSchema = z.object({
  status: z.literal("recorded"),
  evidence_id: UuidSchema,
  evidence_sha256: Sha256Schema,
}).strict();

const MutationFailureSchema = z.object({
  status: z.enum([
    "invalid_request",
    "provider_unsupported",
    "credential_unavailable",
    "model_evidence_unavailable",
    "idempotency_conflict",
    "authority_invalid",
    "not_found",
    "independent_reviewer_required",
    "workspace_conflict",
    "staged_limit_reached",
  ]),
}).strict();

type AdminContext = {
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
  actorId: string;
  workspaceId: string;
};

type ErrorCode =
  | "INVALID_REQUEST"
  | "CROSS_ORIGIN_REQUEST"
  | "NOT_AUTHENTICATED"
  | "INSUFFICIENT_PERMISSIONS"
  | "AI_RUNTIME_BINDING_UNAVAILABLE"
  | "AI_RUNTIME_AUTHORITY_CHANGED"
  | "AI_RUNTIME_STAGED_LIMIT_REACHED"
  | "AI_RUNTIME_BINDING_RATE_LIMITED"
  | "AI_RUNTIME_PROVIDER_UNSUPPORTED"
  | "AI_RUNTIME_CREDENTIAL_UNAVAILABLE"
  | "AI_RUNTIME_IDEMPOTENCY_CONFLICT"
  | "AI_RUNTIME_AUTHORITY_INVALID"
  | "AI_RUNTIME_MODEL_CAPABILITY_UNAVAILABLE"
  | "AI_RUNTIME_MODEL_VERIFICATION_UNAVAILABLE"
  | "AI_RUNTIME_BINDING_SET_NOT_FOUND"
  | "AI_RUNTIME_INDEPENDENT_REVIEW_REQUIRED";

function requestId(req: NextRequest): string {
  const supplied = req.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
}

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function fail(
  status: number,
  code: ErrorCode,
  correlationId: string,
  retryAfter?: number,
): NextResponse {
  const response = noStoreJson({ ok: false, code, requestId: correlationId }, status);
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

async function adminContext(correlationId: string): Promise<AdminContext | NextResponse> {
  if (prodFailClosed() || !supabaseEnabled) {
    return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  }
  const session = await getServerSupabase();
  if (!session) return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  const admin = await requireAdmin(session);
  if (!admin.ok) {
    if (admin.response.status === 401) return fail(401, "NOT_AUTHENTICATED", correlationId);
    if (admin.response.status === 403) {
      return fail(403, "INSUFFICIENT_PERMISSIONS", correlationId);
    }
    return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  }
  const [{ data: auth }, { data: workspaceId, error: workspaceError }] = await Promise.all([
    session.auth.getUser(),
    session.rpc("current_workspace_id"),
  ]);
  const actorId = auth.user?.id;
  if (!UuidSchema.safeParse(actorId).success) {
    return fail(401, "NOT_AUTHENTICATED", correlationId);
  }
  if (workspaceError || !UuidSchema.safeParse(workspaceId).success) {
    return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  }
  return {
    session,
    actorId: actorId as string,
    workspaceId: workspaceId as string,
  };
}

function mutationBoundary(req: NextRequest, correlationId: string): NextResponse | null {
  const boundary = classifySameOriginJsonRequest(req);
  if (boundary === "unsupported_media_type") {
    return fail(415, "INVALID_REQUEST", correlationId);
  }
  if (boundary === "cross_origin_request") {
    return fail(403, "CROSS_ORIGIN_REQUEST", correlationId);
  }
  return null;
}

function idempotencyKey(req: NextRequest, correlationId: string): string | NextResponse {
  const value = req.headers.get("idempotency-key")?.trim() ?? "";
  return UuidSchema.safeParse(value).success
    ? value
    : fail(400, "INVALID_REQUEST", correlationId);
}

function rateLimit(
  req: NextRequest,
  scope: string,
  actorId: string,
  correlationId: string,
  max: number,
): NextResponse | null {
  const limited = checkRateLimit(rateLimitKey(req, scope, actorId), {
    windowMs: 60_000,
    max,
  });
  return limited.ok
    ? null
    : fail(429, "AI_RUNTIME_BINDING_RATE_LIMITED", correlationId, limited.retryAfterSec);
}

function mapFailure(
  status: z.infer<typeof MutationFailureSchema>["status"],
  correlationId: string,
): NextResponse {
  switch (status) {
    case "invalid_request":
      return fail(400, "INVALID_REQUEST", correlationId);
    case "provider_unsupported":
      return fail(400, "AI_RUNTIME_PROVIDER_UNSUPPORTED", correlationId);
    case "credential_unavailable":
      return fail(409, "AI_RUNTIME_CREDENTIAL_UNAVAILABLE", correlationId);
    case "model_evidence_unavailable":
      return fail(409, "AI_RUNTIME_MODEL_CAPABILITY_UNAVAILABLE", correlationId);
    case "idempotency_conflict":
      return fail(409, "AI_RUNTIME_IDEMPOTENCY_CONFLICT", correlationId);
    case "authority_invalid":
      return fail(409, "AI_RUNTIME_AUTHORITY_INVALID", correlationId);
    case "not_found":
      return fail(404, "AI_RUNTIME_BINDING_SET_NOT_FOUND", correlationId);
    case "independent_reviewer_required":
      return fail(409, "AI_RUNTIME_INDEPENDENT_REVIEW_REQUIRED", correlationId);
    case "workspace_conflict":
      return fail(409, "AI_RUNTIME_AUTHORITY_CHANGED", correlationId);
    case "staged_limit_reached":
      return fail(409, "AI_RUNTIME_STAGED_LIMIT_REACHED", correlationId);
  }
}

function publicBinding(
  binding: z.infer<typeof BindingRowSchema>,
  validKeyIds: ReadonlySet<string>,
) {
  return {
    purpose: binding.purpose,
    providerSlug: binding.provider_slug,
    credentialProvider: binding.credential_provider,
    endpointProfile: binding.endpoint_profile,
    catalogRevision: binding.catalog_revision,
    modelName: binding.model_name,
    apiKeyId: binding.api_key_id,
    credentialAvailable: validKeyIds.has(binding.api_key_id),
  };
}

type CapabilityBinding = {
  purpose: ExecutionModelPurpose;
  providerSlug: string;
  modelName: string;
  apiKeyId: string;
};

type CapabilityEvidenceResult =
  | {
      ok: true;
      evidenceByPurpose: Record<ExecutionModelPurpose, string>;
    }
  | {
      ok: false;
      state: "rejected" | "unavailable" | "backend_error";
    };

/**
 * Run a bounded paid preflight on the exact model and protocol, then persist a
 * short-lived service attestation. The browser never sees the secret or the
 * evidence id; the authenticated SQL mutation must consume both attestations.
 */
async function attestExactModelCapabilities(
  service: NonNullable<ReturnType<typeof getServiceSupabase>>,
  workspaceId: string,
  bindings: readonly CapabilityBinding[],
): Promise<CapabilityEvidenceResult> {
  if (
    bindings.length !== 2 ||
    bindings.filter((binding) => binding.purpose === "requisition_parse").length !== 1 ||
    bindings.filter((binding) => binding.purpose === "sourcing").length !== 1
  ) {
    return { ok: false, state: "backend_error" };
  }

  const providerSlugs = [...new Set(bindings.map((binding) => binding.providerSlug))];
  const keyIds = [...new Set(bindings.map((binding) => binding.apiKeyId))];
  const [catalogResult, keysResult] = await Promise.all([
    service
      .from("ai_provider_catalog")
      .select("provider_slug,credential_provider,endpoint_profile,supports_requisition_parse,supports_sourcing,catalog_revision")
      .in("provider_slug", providerSlugs),
    service
      .from("api_keys")
      .select("id,workspace_id,provider,status,secret")
      .eq("workspace_id", workspaceId)
      .eq("status", "valid")
      .in("id", keyIds),
  ]);
  if (catalogResult.error || keysResult.error) {
    return { ok: false, state: "backend_error" };
  }
  const catalog = z.array(CatalogRowSchema).max(2).safeParse(catalogResult.data ?? []);
  const keys = z.array(ModelCapabilityKeyRowSchema).max(2).safeParse(keysResult.data ?? []);
  if (!catalog.success || !keys.success) {
    return { ok: false, state: "backend_error" };
  }
  const catalogBySlug = new Map(catalog.data.map((row) => [row.provider_slug, row]));
  const keyById = new Map(keys.data.map((row) => [row.id, row]));

  const prepared: Array<{
    binding: CapabilityBinding;
    credentialProvider: Exclude<ExecutionCredentialProvider, "Tavily">;
    secret: string;
  }> = [];
  try {
    for (const binding of bindings) {
      const provider = catalogBySlug.get(binding.providerSlug);
      const key = keyById.get(binding.apiKeyId);
      const supportsPurpose = binding.purpose === "requisition_parse"
        ? provider?.supports_requisition_parse
        : provider?.supports_sourcing;
      if (
        !provider ||
        !supportsPurpose ||
        !key ||
        key.workspace_id !== workspaceId ||
        key.provider !== provider.credential_provider ||
        !isExecutionCredentialProvider(key.provider) ||
        key.provider === "Tavily"
      ) {
        return { ok: false, state: "backend_error" };
      }
      prepared.push({
        binding,
        credentialProvider: key.provider,
        secret: decryptSecret(key.secret),
      });
    }
  } catch {
    return { ok: false, state: "backend_error" };
  }

  const probes = await Promise.all(prepared.map(({ binding, credentialProvider, secret }) =>
    verifyExecutionModelCapability(
      credentialProvider,
      secret,
      binding.modelName,
      binding.purpose,
    )
  ));
  if (probes.some((probe) => probe.state === "unavailable")) {
    return { ok: false, state: "unavailable" };
  }
  if (probes.some((probe) => probe.state !== "verified")) {
    return { ok: false, state: "rejected" };
  }

  const recorded = await Promise.all(prepared.map(async ({ binding, credentialProvider }) => {
    const result = await service.rpc("record_ai_runtime_model_evidence", {
      p_expected_workspace_id: workspaceId,
      p_api_key_id: binding.apiKeyId,
      p_credential_provider: credentialProvider,
      p_model_name: binding.modelName,
      p_purpose: binding.purpose,
    });
    if (result.error) return null;
    const parsed = ModelEvidenceReceiptSchema.safeParse(result.data);
    return parsed.success ? { purpose: binding.purpose, id: parsed.data.evidence_id } : null;
  }));
  if (recorded.some((entry) => entry === null)) {
    return { ok: false, state: "backend_error" };
  }
  const evidenceByPurpose = Object.fromEntries(
    recorded.map((entry) => [entry!.purpose, entry!.id]),
  ) as Partial<Record<ExecutionModelPurpose, string>>;
  if (!evidenceByPurpose.requisition_parse || !evidenceByPurpose.sourcing) {
    return { ok: false, state: "backend_error" };
  }
  return {
    ok: true,
    evidenceByPurpose: {
      requisition_parse: evidenceByPurpose.requisition_parse,
      sourcing: evidenceByPurpose.sourcing,
    },
  };
}

function capabilityFailure(
  result: Extract<CapabilityEvidenceResult, { ok: false }>,
  correlationId: string,
): NextResponse {
  if (result.state === "rejected") {
    return fail(409, "AI_RUNTIME_MODEL_CAPABILITY_UNAVAILABLE", correlationId);
  }
  if (result.state === "unavailable") {
    return fail(503, "AI_RUNTIME_MODEL_VERIFICATION_UNAVAILABLE", correlationId);
  }
  return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
}

export async function GET(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    const context = await adminContext(correlationId);
    if (context instanceof NextResponse) return context;
    const limited = rateLimit(
      req,
      "admin-ai-runtime-bindings-read",
      context.actorId,
      correlationId,
      120,
    );
    if (limited) return limited;

    const service = getServiceSupabase();
    if (!service) return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);

    const [catalogResult, keysResult, setsResult, adminsResult] = await Promise.all([
      service
        .from("ai_provider_catalog")
        .select("provider_slug,credential_provider,endpoint_profile,supports_requisition_parse,supports_sourcing,catalog_revision")
        .order("provider_slug"),
      service
        .from("api_keys")
        .select("id,name,provider,last4,status,last_tested_at")
        .eq("workspace_id", context.workspaceId)
        .eq("status", "valid")
        .order("provider", { ascending: true })
        .order("name", { ascending: true }),
      service
        .from("ai_runtime_binding_sets")
        .select("id,status,set_sha256,proposed_by,proposed_at,activated_at")
        .eq("workspace_id", context.workspaceId)
        .in("status", ["active", "staged"])
        .order("proposed_at", { ascending: false }),
      service
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", context.workspaceId)
        .eq("role", "admin"),
    ]);
    if (catalogResult.error || keysResult.error || setsResult.error || adminsResult.error) {
      return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
    }

    const catalog = z.array(CatalogRowSchema).max(100).safeParse(catalogResult.data ?? []);
    const keys = z.array(KeyRowSchema).max(1_000).safeParse(keysResult.data ?? []);
    const sets = z.array(BindingSetRowSchema).max(100).safeParse(setsResult.data ?? []);
    const parsedAdminCount = z.number().int().min(1).max(100_000).safeParse(adminsResult.count);
    if (!catalog.success || !keys.success || !sets.success || !parsedAdminCount.success) {
      return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
    }

    const activeRows = sets.data.filter((set) => set.status === "active");
    if (activeRows.length > 1) {
      return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
    }
    const setIds = sets.data.map((set) => set.id);
    let bindings: z.infer<typeof BindingRowSchema>[] = [];
    if (setIds.length > 0) {
      const bindingsResult = await service
        .from("ai_runtime_bindings")
        .select("binding_set_id,purpose,provider_slug,credential_provider,endpoint_profile,catalog_revision,model_name,api_key_id")
        .eq("workspace_id", context.workspaceId)
        .in("binding_set_id", setIds)
        .order("purpose", { ascending: true });
      if (bindingsResult.error) {
        return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
      }
      const parsedBindings = z.array(BindingRowSchema).max(200).safeParse(bindingsResult.data ?? []);
      if (!parsedBindings.success) {
        return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
      }
      bindings = parsedBindings.data;
    }

    const catalogBySlug = new Map(catalog.data.map((row) => [row.provider_slug, row]));
    const bindingsBySet = new Map<string, z.infer<typeof BindingRowSchema>[]>();
    for (const binding of bindings) {
      if (!setIds.includes(binding.binding_set_id)) {
        return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
      }
      const provider = catalogBySlug.get(binding.provider_slug);
      const capabilityMatches = binding.purpose === "requisition_parse"
        ? provider?.supports_requisition_parse
        : provider?.supports_sourcing;
      if (
        !provider || !capabilityMatches ||
        provider.credential_provider !== binding.credential_provider ||
        provider.endpoint_profile !== binding.endpoint_profile ||
        provider.catalog_revision !== binding.catalog_revision
      ) {
        return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
      }
      const group = bindingsBySet.get(binding.binding_set_id) ?? [];
      group.push(binding);
      bindingsBySet.set(binding.binding_set_id, group);
    }
    for (const set of sets.data) {
      const group = bindingsBySet.get(set.id) ?? [];
      if (
        group.length !== 2 ||
        group.filter((binding) => binding.purpose === "requisition_parse").length !== 1 ||
        group.filter((binding) => binding.purpose === "sourcing").length !== 1
      ) {
        return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
      }
    }

    const validKeyIds = new Set(keys.data.map((key) => key.id));
    const toPublicSet = (set: z.infer<typeof BindingSetRowSchema>) => ({
      id: set.id,
      status: set.status,
      setSha256: set.set_sha256,
      proposedAt: set.proposed_at,
      activatedAt: set.activated_at,
      bindings: (bindingsBySet.get(set.id) ?? [])
        .sort((left, right) => left.purpose.localeCompare(right.purpose))
        .map((binding) => publicBinding(binding, validKeyIds)),
    });
    const activeSet = activeRows[0] ? toPublicSet(activeRows[0]) : null;
    const stagedSets = sets.data
      .filter((set) => set.status === "staged")
      .map((set) => ({
        ...toPublicSet(set),
        proposedBySelf: set.proposed_by === context.actorId,
        canActivate:
          parsedAdminCount.data >= 2 && set.proposed_by !== context.actorId,
      }));

    // These reads cross RLS only after an admin check. Revalidate immediately
    // before disclosure so a concurrent role or workspace change cannot leak
    // metadata from the tenant that was authorized at the start of the request.
    const current = await adminContext(correlationId);
    if (current instanceof NextResponse) return current;
    if (current.actorId !== context.actorId || current.workspaceId !== context.workspaceId) {
      return fail(409, "AI_RUNTIME_AUTHORITY_CHANGED", correlationId);
    }

    return noStoreJson({
      ok: true,
      catalog: catalog.data.map((provider) => ({
        providerSlug: provider.provider_slug,
        credentialProvider: provider.credential_provider,
        endpointProfile: provider.endpoint_profile,
        supportsRequisitionParse: provider.supports_requisition_parse,
        supportsSourcing: provider.supports_sourcing,
        catalogRevision: provider.catalog_revision,
      })),
      keys: keys.data.map((key) => ({
        id: key.id,
        name: key.name,
        provider: key.provider,
        last4: key.last4,
        status: key.status,
        lastTestedAt: key.last_tested_at,
      })),
      activeSet,
      stagedSets,
      adminCount: parsedAdminCount.data,
      self: {
        hasStagedProposal: stagedSets.some((set) => set.proposedBySelf),
        canActivate: stagedSets.some((set) => set.canActivate),
      },
    });
  } catch {
    return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    const boundary = mutationBoundary(req, correlationId);
    if (boundary) return boundary;
    const operationId = idempotencyKey(req, correlationId);
    if (operationId instanceof NextResponse) return operationId;
    const context = await adminContext(correlationId);
    if (context instanceof NextResponse) return context;
    const limited = rateLimit(
      req,
      "admin-ai-runtime-bindings-stage",
      context.actorId,
      correlationId,
      20,
    );
    if (limited) return limited;
    const validated = await validateBody(req, StageSchema, { maxBytes: 4_000 });
    if (!validated.ok) return fail(validated.response.status, "INVALID_REQUEST", correlationId);

    const service = getServiceSupabase();
    if (!service) return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
    const capabilityEvidence = await attestExactModelCapabilities(
      service,
      context.workspaceId,
      [
        {
          purpose: "requisition_parse",
          providerSlug: validated.data.requisitionParse.providerSlug,
          modelName: validated.data.requisitionParse.modelName,
          apiKeyId: validated.data.requisitionParse.apiKeyId,
        },
        {
          purpose: "sourcing",
          providerSlug: validated.data.sourcing.providerSlug,
          modelName: validated.data.sourcing.modelName,
          apiKeyId: validated.data.sourcing.apiKeyId,
        },
      ],
    );
    if (!capabilityEvidence.ok) return capabilityFailure(capabilityEvidence, correlationId);

    const { data, error } = await context.session.rpc("stage_ai_runtime_binding_set", {
      p_idempotency_key: operationId,
      p_parse_provider_slug: validated.data.requisitionParse.providerSlug,
      p_parse_model_name: validated.data.requisitionParse.modelName,
      p_parse_api_key_id: validated.data.requisitionParse.apiKeyId,
      p_parse_model_evidence_id: capabilityEvidence.evidenceByPurpose.requisition_parse,
      p_sourcing_provider_slug: validated.data.sourcing.providerSlug,
      p_sourcing_model_name: validated.data.sourcing.modelName,
      p_sourcing_api_key_id: validated.data.sourcing.apiKeyId,
      p_sourcing_model_evidence_id: capabilityEvidence.evidenceByPurpose.sourcing,
      p_expected_workspace_id: context.workspaceId,
    });
    if (error) return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);

    const receipt = MutationReceiptSchema.safeParse(data);
    if (receipt.success && ["staged", "active", "superseded"].includes(receipt.data.status)) {
      return noStoreJson({
        ok: true,
        status: receipt.data.status,
        replayed: receipt.data.replay,
        bindingSetId: receipt.data.binding_set_id,
        setSha256: receipt.data.set_sha256,
        receiptSha256: receipt.data.receipt_sha256,
      }, receipt.data.status === "staged" && !receipt.data.replay ? 201 : 200);
    }
    const refused = MutationFailureSchema.safeParse(data);
    return refused.success
      ? mapFailure(refused.data.status, correlationId)
      : fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  } catch {
    return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  }
}

export async function PATCH(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    const boundary = mutationBoundary(req, correlationId);
    if (boundary) return boundary;
    const operationId = idempotencyKey(req, correlationId);
    if (operationId instanceof NextResponse) return operationId;
    const context = await adminContext(correlationId);
    if (context instanceof NextResponse) return context;
    const limited = rateLimit(
      req,
      "admin-ai-runtime-bindings-activate",
      context.actorId,
      correlationId,
      20,
    );
    if (limited) return limited;
    const validated = await validateBody(req, ActivateSchema, { maxBytes: 1_000 });
    if (!validated.ok) return fail(validated.response.status, "INVALID_REQUEST", correlationId);

    const service = getServiceSupabase();
    if (!service) return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
    const [setResult, bindingsResult] = await Promise.all([
      service
        .from("ai_runtime_binding_sets")
        .select("id,status")
        .eq("workspace_id", context.workspaceId)
        .eq("id", validated.data.bindingSetId)
        .eq("status", "staged"),
      service
        .from("ai_runtime_bindings")
        .select("binding_set_id,purpose,provider_slug,credential_provider,endpoint_profile,catalog_revision,model_name,api_key_id")
        .eq("workspace_id", context.workspaceId)
        .eq("binding_set_id", validated.data.bindingSetId)
        .order("purpose", { ascending: true }),
    ]);
    if (setResult.error || bindingsResult.error) {
      return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
    }
    const sets = z.array(z.object({
      id: UuidSchema,
      status: z.literal("staged"),
    })).max(1).safeParse(setResult.data ?? []);
    const bindings = z.array(BindingRowSchema).max(2).safeParse(bindingsResult.data ?? []);
    if (!sets.success || !bindings.success) {
      return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
    }
    if (sets.data.length !== 1) {
      return fail(404, "AI_RUNTIME_BINDING_SET_NOT_FOUND", correlationId);
    }
    if (bindings.data.some((binding) => binding.binding_set_id !== validated.data.bindingSetId)) {
      return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
    }
    const capabilityEvidence = await attestExactModelCapabilities(
      service,
      context.workspaceId,
      bindings.data.map((binding) => ({
        purpose: binding.purpose,
        providerSlug: binding.provider_slug,
        modelName: binding.model_name,
        apiKeyId: binding.api_key_id,
      })),
    );
    if (!capabilityEvidence.ok) return capabilityFailure(capabilityEvidence, correlationId);

    const { data, error } = await context.session.rpc("activate_ai_runtime_binding_set", {
      p_binding_set_id: validated.data.bindingSetId,
      p_idempotency_key: operationId,
      p_parse_model_evidence_id: capabilityEvidence.evidenceByPurpose.requisition_parse,
      p_sourcing_model_evidence_id: capabilityEvidence.evidenceByPurpose.sourcing,
      p_expected_workspace_id: context.workspaceId,
    });
    if (error) return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);

    const receipt = MutationReceiptSchema.safeParse(data);
    if (receipt.success && receipt.data.status === "activated") {
      return noStoreJson({
        ok: true,
        status: receipt.data.status,
        replayed: receipt.data.replay,
        bindingSetId: receipt.data.binding_set_id,
        setSha256: receipt.data.set_sha256,
        receiptSha256: receipt.data.receipt_sha256,
      });
    }
    const refused = MutationFailureSchema.safeParse(data);
    return refused.success
      ? mapFailure(refused.data.status, correlationId)
      : fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  } catch {
    return fail(503, "AI_RUNTIME_BINDING_UNAVAILABLE", correlationId);
  }
}
