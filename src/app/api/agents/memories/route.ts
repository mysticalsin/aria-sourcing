import { createHash, randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { classifySameOriginJsonRequest } from "@/lib/api/same-origin-json";
import {
  decryptSecret,
  encryptionRequiredButMissing,
  encryptSecret,
  secretEncryptionEnabled,
} from "@/lib/crypto-secrets";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = z.string().uuid();
const SPEC_LIST_LIMIT = 100;
const DEFAULT_MEMORY_PAGE_LIMIT = 25;
const MAX_MEMORY_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MemoryKindSchema = z.enum(["fact", "preference", "instruction", "episodic"]);
const ExpiresAtSchema = z.string().datetime({ offset: true }).nullable();
const MemoryCursorSchema = z.object({
  v: z.literal(1),
  specId: UUID,
  createdAt: z.string().datetime({ offset: true }),
  id: UUID,
}).strict();
const SpecCursorSchema = z.object({
  v: z.literal(1),
  createdAt: z.string().datetime({ offset: true }),
  id: UUID,
}).strict();
const MemoryContentSchema = z.string().trim().min(1).max(8192).refine(
  (value) => Buffer.byteLength(value, "utf8") <= 8192,
  { message: "Memory content exceeds the UTF-8 byte limit." },
);

const CreateMemorySchema = z.object({
  specId: UUID,
  kind: MemoryKindSchema,
  content: MemoryContentSchema,
  pinned: z.boolean().optional().default(false),
  expiresAt: ExpiresAtSchema.optional().default(null),
}).strict();

const EditMemorySchema = z.object({
  action: z.literal("edit"),
  id: UUID,
  specId: UUID,
  revision: z.number().int().min(1),
  kind: MemoryKindSchema.optional(),
  content: MemoryContentSchema.optional(),
  pinned: z.boolean().optional(),
  expiresAt: ExpiresAtSchema.optional(),
}).strict().refine(
  (value) => value.kind !== undefined || value.content !== undefined
    || value.pinned !== undefined || value.expiresAt !== undefined,
  { message: "At least one memory field must change." },
);

const ReviewMemorySchema = z.object({
  action: z.enum(["approve", "reject"]),
  id: UUID,
  specId: UUID,
  revision: z.number().int().min(1),
}).strict();

const UpdateMemorySchema = z.union([EditMemorySchema, ReviewMemorySchema]);
const DeleteMemorySchema = z.object({
  id: UUID,
  specId: UUID,
  revision: z.number().int().min(1),
}).strict();

type MemoryRow = {
  id: string;
  spec_id: string;
  kind: string;
  content_ciphertext: string;
  content_sha256: string;
  content_byte_count: number;
  revision: number;
  status: "pending_review" | "approved" | "rejected" | "deleted";
  source_type: string;
  pinned: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type AgentSpecRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
};

type RequestAuthority = {
  userId: string;
  workspaceId: string;
  service: NonNullable<ReturnType<typeof getServiceSupabase>>;
};

type MemoryCursor = z.infer<typeof MemoryCursorSchema>;
type SpecCursor = z.infer<typeof SpecCursorSchema>;

type ErrorCode =
  | "invalid_request"
  | "cross_origin_request"
  | "not_authenticated"
  | "insufficient_permissions"
  | "memory_not_found"
  | "revision_conflict"
  | "memory_in_use"
  | "invalid_state"
  | "rate_limited"
  | "memory_authority_unavailable";

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

function fail(status: number, code: ErrorCode, correlationId: string): NextResponse {
  return noStoreJson({ ok: false, code, requestId: correlationId }, status);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeMemoryCursor(row: Pick<MemoryRow, "id" | "spec_id" | "created_at">): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    specId: row.spec_id,
    createdAt: row.created_at,
    id: row.id,
  } satisfies MemoryCursor), "utf8").toString("base64url");
}

function encodeSpecCursor(row: Pick<AgentSpecRow, "id" | "created_at">): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    createdAt: row.created_at,
    id: row.id,
  } satisfies SpecCursor), "utf8").toString("base64url");
}

function decodeMemoryCursor(value: string): MemoryCursor | null {
  if (
    value.length < 1
    || value.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value || decoded.byteLength > MAX_CURSOR_LENGTH) {
      return null;
    }
    const parsed = MemoryCursorSchema.safeParse(JSON.parse(decoded.toString("utf8")));
    if (!parsed.success) return null;
    const canonical = Buffer.from(JSON.stringify(parsed.data), "utf8").toString("base64url");
    return canonical === value ? parsed.data : null;
  } catch {
    return null;
  }
}

function decodeSpecCursor(value: string): SpecCursor | null {
  if (
    value.length < 1
    || value.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value || decoded.byteLength > MAX_CURSOR_LENGTH) {
      return null;
    }
    const parsed = SpecCursorSchema.safeParse(JSON.parse(decoded.toString("utf8")));
    if (!parsed.success) return null;
    const canonical = Buffer.from(JSON.stringify(parsed.data), "utf8").toString("base64url");
    return canonical === value ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseMemoryPageLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_MEMORY_PAGE_LIMIT;
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_MEMORY_PAGE_LIMIT ? parsed : null;
}

function encryptionAvailable(): boolean {
  return !encryptionRequiredButMissing() && secretEncryptionEnabled();
}

function encryptMemoryContent(content: string): {
  ciphertext: string;
  contentSha256: string;
  contentByteCount: number;
} | null {
  const contentByteCount = Buffer.byteLength(content, "utf8");
  if (contentByteCount < 1 || contentByteCount > 8192 || !encryptionAvailable()) return null;
  const ciphertext = encryptSecret(content);
  if (!ciphertext.startsWith("enc:v2:")) return null;
  return { ciphertext, contentSha256: sha256(content), contentByteCount };
}

function exposeMemory(row: MemoryRow) {
  const content = decryptSecret(row.content_ciphertext);
  if (
    !content
    || sha256(content) !== row.content_sha256
    || Buffer.byteLength(content, "utf8") !== row.content_byte_count
  ) {
    throw new Error("memory_integrity_failure");
  }
  return {
    id: row.id,
    specId: row.spec_id,
    kind: row.kind,
    content,
    revision: row.revision,
    status: row.status,
    sourceType: row.source_type,
    pinned: row.pinned,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function authority(req: NextRequest, correlationId: string): Promise<
  { ok: true; value: RequestAuthority } | { ok: false; response: NextResponse }
> {
  const prodBlock = prodFailClosed();
  if (prodBlock) return { ok: false, response: fail(503, "memory_authority_unavailable", correlationId) };
  if (!supabaseEnabled) {
    return { ok: false, response: fail(503, "memory_authority_unavailable", correlationId) };
  }
  const session = await getServerSupabase();
  if (!session) return { ok: false, response: fail(503, "memory_authority_unavailable", correlationId) };
  const { data: authData, error: authError } = await session.auth.getUser();
  if (authError) {
    return { ok: false, response: fail(503, "memory_authority_unavailable", correlationId) };
  }
  const user = authData.user;
  if (!user) return { ok: false, response: fail(401, "not_authenticated", correlationId) };
  const [{ data: workspaceId, error: workspaceError }, { data: role, error: roleError }] = await Promise.all([
    session.rpc("current_workspace_id"),
    session.rpc("current_profile_role"),
  ]);
  if (
    workspaceError || roleError || typeof workspaceId !== "string"
    || !UUID.safeParse(workspaceId).success
  ) {
    return { ok: false, response: fail(503, "memory_authority_unavailable", correlationId) };
  }
  if (!can(role as Role, "skills")) {
    return { ok: false, response: fail(403, "insufficient_permissions", correlationId) };
  }
  const service = getServiceSupabase();
  if (!service) return { ok: false, response: fail(503, "memory_authority_unavailable", correlationId) };
  return { ok: true, value: { userId: user.id, workspaceId, service } };
}

async function ownedSpec(
  auth: RequestAuthority,
  specId: string,
): Promise<
  | { status: "found"; spec: { id: string; name: string; status: string } }
  | { status: "not_found" }
  | { status: "unavailable" }
> {
  const { data, error } = await auth.service
    .from("agent_specs")
    .select("id,name,status")
    .eq("workspace_id", auth.workspaceId)
    .eq("owner_id", auth.userId)
    .eq("id", specId)
    .maybeSingle();
  if (error) return { status: "unavailable" };
  if (!data) return { status: "not_found" };
  return { status: "found", spec: data };
}

async function memoryById(
  auth: RequestAuthority,
  specId: string,
  memoryId: string,
): Promise<MemoryRow | null> {
  const { data, error } = await auth.service
    .from("agent_memories")
    .select("id,spec_id,kind,content_ciphertext,content_sha256,content_byte_count,revision,status,source_type,pinned,expires_at,created_at,updated_at")
    .eq("workspace_id", auth.workspaceId)
    .eq("owner_id", auth.userId)
    .eq("spec_id", specId)
    .eq("id", memoryId)
    .neq("status", "deleted")
    .is("deleted_at", null)
    .maybeSingle();
  return error || !data ? null : data as MemoryRow;
}

export async function GET(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    const specParam = req.nextUrl.searchParams.get("specId");
    const specCursorParam = req.nextUrl.searchParams.get("specCursor");
    const cursorParam = req.nextUrl.searchParams.get("cursor");
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = parseMemoryPageLimit(limitParam);
    const specCursor = specCursorParam === null ? null : decodeSpecCursor(specCursorParam);
    const cursor = cursorParam === null ? null : decodeMemoryCursor(cursorParam);
    const allowedParams = new Set(["specId", "specCursor", "cursor", "limit"]);
    if (
      [...req.nextUrl.searchParams.keys()].some((key) => !allowedParams.has(key))
      || req.nextUrl.searchParams.getAll("specId").length > 1
      || req.nextUrl.searchParams.getAll("specCursor").length > 1
      || req.nextUrl.searchParams.getAll("cursor").length > 1
      || req.nextUrl.searchParams.getAll("limit").length > 1
      || (specParam !== null && !UUID.safeParse(specParam).success)
      || (specCursorParam !== null && specCursor === null)
      || (specParam !== null && specCursorParam !== null)
      || ((cursorParam !== null || limitParam !== null) && specParam === null)
      || limit === null
      || (cursorParam !== null && cursor === null)
      || (cursor !== null && cursor.specId !== specParam)
    ) {
      return fail(400, "invalid_request", correlationId);
    }
    const checked = await authority(req, correlationId);
    if (!checked.ok) return checked.response;
    const auth = checked.value;
    if (!encryptionAvailable()) return fail(503, "memory_authority_unavailable", correlationId);

    let specs: Array<{ id: string; name: string; status: string }>;
    let specsTruncated = false;
    let nextSpecCursor: string | null = null;
    if (specParam) {
      const specLookup = await ownedSpec(auth, specParam);
      if (specLookup.status === "unavailable") {
        return fail(503, "memory_authority_unavailable", correlationId);
      }
      if (specLookup.status === "not_found") return fail(404, "memory_not_found", correlationId);
      specs = [specLookup.spec];
    } else {
      let specQuery = auth.service
        .from("agent_specs")
        .select("id,name,status,created_at")
        .eq("workspace_id", auth.workspaceId)
        .eq("owner_id", auth.userId)
        .neq("status", "archived")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (specCursor) {
        specQuery = specQuery.or(
          `created_at.gt.${specCursor.createdAt},and(created_at.eq.${specCursor.createdAt},id.gt.${specCursor.id})`,
        );
      }
      const { data, error } = await specQuery.limit(SPEC_LIST_LIMIT + 1);
      if (error) return fail(503, "memory_authority_unavailable", correlationId);
      const specRows = (data ?? []) as AgentSpecRow[];
      specsTruncated = specRows.length > SPEC_LIST_LIMIT;
      const pageRows = specRows.slice(0, SPEC_LIST_LIMIT);
      specs = pageRows.map(({ id, name, status }) => ({ id, name, status }));
      const lastRow = pageRows.at(-1);
      nextSpecCursor = specsTruncated && lastRow ? encodeSpecCursor(lastRow) : null;
    }

    if (specs.length === 0) {
      return noStoreJson({
        ok: true,
        specs: [],
        memories: [],
        nextCursor: null,
        nextSpecCursor: null,
        bounds: {
          specLimit: SPEC_LIST_LIMIT,
          specsTruncated,
        },
        requestId: correlationId,
      });
    }
    if (!specParam) {
      return noStoreJson({
        ok: true,
        specs,
        memories: [],
        nextCursor: null,
        nextSpecCursor,
        bounds: {
          specLimit: SPEC_LIST_LIMIT,
          specsTruncated,
        },
        requestId: correlationId,
      });
    }

    let memoryQuery = auth.service
      .from("agent_memories")
      .select("id,spec_id,kind,content_ciphertext,content_sha256,content_byte_count,revision,status,source_type,pinned,expires_at,created_at,updated_at")
      .eq("workspace_id", auth.workspaceId)
      .eq("owner_id", auth.userId)
      .eq("spec_id", specParam)
      .neq("status", "deleted")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor) {
      memoryQuery = memoryQuery.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await memoryQuery.limit(limit + 1);
    if (error) return fail(503, "memory_authority_unavailable", correlationId);
    const memoryRows = (data ?? []) as MemoryRow[];
    const hasMore = memoryRows.length > limit;
    const pageRows = memoryRows.slice(0, limit);
    const memories = pageRows.map(exposeMemory);
    const lastRow = pageRows.at(-1);
    return noStoreJson({
      ok: true,
      specs,
      memories,
      nextCursor: hasMore && lastRow ? encodeMemoryCursor(lastRow) : null,
      nextSpecCursor: null,
      bounds: {
        specLimit: SPEC_LIST_LIMIT,
        specsTruncated,
      },
      requestId: correlationId,
    });
  } catch {
    return fail(503, "memory_authority_unavailable", correlationId);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    const requestBoundary = classifySameOriginJsonRequest(req);
    if (requestBoundary !== "ok") {
      return fail(
        requestBoundary === "unsupported_media_type" ? 415 : 403,
        requestBoundary === "unsupported_media_type" ? "invalid_request" : "cross_origin_request",
        correlationId,
      );
    }
    const checked = await authority(req, correlationId);
    if (!checked.ok) return checked.response;
    const auth = checked.value;
    if (!encryptionAvailable()) return fail(503, "memory_authority_unavailable", correlationId);
    const limit = checkRateLimit(rateLimitKey(req, "agent-memory-create", auth.userId), {
      windowMs: 60_000,
      max: 20,
    });
    if (!limit.ok) {
      const response = fail(429, "rate_limited", correlationId);
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }
    const validated = await validateBody(req, CreateMemorySchema, { maxBytes: 12_000 });
    if (!validated.ok) return fail(400, "invalid_request", correlationId);
    const specLookup = await ownedSpec(auth, validated.data.specId);
    if (specLookup.status === "unavailable") {
      return fail(503, "memory_authority_unavailable", correlationId);
    }
    if (specLookup.status === "not_found" || specLookup.spec.status === "archived") {
      return fail(404, "memory_not_found", correlationId);
    }
    const encrypted = encryptMemoryContent(validated.data.content);
    if (!encrypted) return fail(503, "memory_authority_unavailable", correlationId);
    const { data, error } = await auth.service.rpc("create_agent_memory", {
      p_workspace_id: auth.workspaceId,
      p_owner_id: auth.userId,
      p_spec_id: validated.data.specId,
      p_actor_id: auth.userId,
      p_kind: validated.data.kind,
      p_content_ciphertext: encrypted.ciphertext,
      p_content_sha256: encrypted.contentSha256,
      p_content_byte_count: encrypted.contentByteCount,
      p_pinned: validated.data.pinned,
      p_expires_at: validated.data.expiresAt,
    });
    const result = data as { status?: string; id?: string } | null;
    if (result?.status === "invalid_request") return fail(400, "invalid_request", correlationId);
    if (error || result?.status !== "created" || !result.id) {
      return fail(503, "memory_authority_unavailable", correlationId);
    }
    const row = await memoryById(auth, validated.data.specId, result.id);
    if (!row) return fail(503, "memory_authority_unavailable", correlationId);
    const response = noStoreJson({ ok: true, memory: exposeMemory(row), requestId: correlationId }, 201);
    response.headers.set("Location", `/api/agents/memories?specId=${validated.data.specId}`);
    return response;
  } catch {
    return fail(503, "memory_authority_unavailable", correlationId);
  }
}

export async function PATCH(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    const requestBoundary = classifySameOriginJsonRequest(req);
    if (requestBoundary !== "ok") {
      return fail(
        requestBoundary === "unsupported_media_type" ? 415 : 403,
        requestBoundary === "unsupported_media_type" ? "invalid_request" : "cross_origin_request",
        correlationId,
      );
    }
    const checked = await authority(req, correlationId);
    if (!checked.ok) return checked.response;
    const auth = checked.value;
    if (!encryptionAvailable()) return fail(503, "memory_authority_unavailable", correlationId);
    const limit = checkRateLimit(rateLimitKey(req, "agent-memory-update", auth.userId), {
      windowMs: 60_000,
      max: 40,
    });
    if (!limit.ok) {
      const response = fail(429, "rate_limited", correlationId);
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }
    const validated = await validateBody(req, UpdateMemorySchema, { maxBytes: 12_000 });
    if (!validated.ok) return fail(400, "invalid_request", correlationId);
    const specLookup = await ownedSpec(auth, validated.data.specId);
    if (specLookup.status === "unavailable") {
      return fail(503, "memory_authority_unavailable", correlationId);
    }
    if (specLookup.status === "not_found") return fail(404, "memory_not_found", correlationId);
    const encrypted = validated.data.action === "edit" && validated.data.content !== undefined
      ? encryptMemoryContent(validated.data.content)
      : null;
    if (validated.data.action === "edit" && validated.data.content !== undefined && !encrypted) {
      return fail(503, "memory_authority_unavailable", correlationId);
    }
    const { data, error } = await auth.service.rpc("mutate_agent_memory", {
      p_workspace_id: auth.workspaceId,
      p_owner_id: auth.userId,
      p_spec_id: validated.data.specId,
      p_memory_id: validated.data.id,
      p_actor_id: auth.userId,
      p_expected_revision: validated.data.revision,
      p_operation: validated.data.action,
      p_kind: validated.data.action === "edit" ? validated.data.kind ?? null : null,
      p_content_ciphertext: encrypted?.ciphertext ?? null,
      p_content_sha256: encrypted?.contentSha256 ?? null,
      p_content_byte_count: encrypted?.contentByteCount ?? null,
      p_pinned: validated.data.action === "edit" ? validated.data.pinned ?? null : null,
      p_set_expires: validated.data.action === "edit" && validated.data.expiresAt !== undefined,
      p_expires_at: validated.data.action === "edit" ? validated.data.expiresAt ?? null : null,
    });
    const result = data as { status?: string } | null;
    if (error) return fail(503, "memory_authority_unavailable", correlationId);
    if (result?.status === "revision_conflict") return fail(409, "revision_conflict", correlationId);
    if (result?.status === "memory_in_use") return fail(409, "memory_in_use", correlationId);
    if (result?.status === "invalid_state") return fail(409, "invalid_state", correlationId);
    if (result?.status === "not_found") return fail(404, "memory_not_found", correlationId);
    if (result?.status === "invalid_request") return fail(400, "invalid_request", correlationId);
    if (result?.status !== "updated") return fail(400, "invalid_request", correlationId);
    const row = await memoryById(auth, validated.data.specId, validated.data.id);
    if (!row) return fail(503, "memory_authority_unavailable", correlationId);
    return noStoreJson({ ok: true, memory: exposeMemory(row), requestId: correlationId });
  } catch {
    return fail(503, "memory_authority_unavailable", correlationId);
  }
}

export async function DELETE(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    const requestBoundary = classifySameOriginJsonRequest(req);
    if (requestBoundary !== "ok") {
      return fail(
        requestBoundary === "unsupported_media_type" ? 415 : 403,
        requestBoundary === "unsupported_media_type" ? "invalid_request" : "cross_origin_request",
        correlationId,
      );
    }
    const checked = await authority(req, correlationId);
    if (!checked.ok) return checked.response;
    const auth = checked.value;
    if (!encryptionAvailable()) return fail(503, "memory_authority_unavailable", correlationId);
    const limit = checkRateLimit(rateLimitKey(req, "agent-memory-delete", auth.userId), {
      windowMs: 60_000,
      max: 20,
    });
    if (!limit.ok) {
      const response = fail(429, "rate_limited", correlationId);
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }
    const validated = await validateBody(req, DeleteMemorySchema, { maxBytes: 2_000 });
    if (!validated.ok) return fail(400, "invalid_request", correlationId);
    const specLookup = await ownedSpec(auth, validated.data.specId);
    if (specLookup.status === "unavailable") {
      return fail(503, "memory_authority_unavailable", correlationId);
    }
    if (specLookup.status === "not_found") {
      return fail(404, "memory_not_found", correlationId);
    }
    const tombstone = encryptMemoryContent("[deleted]");
    if (!tombstone) return fail(503, "memory_authority_unavailable", correlationId);
    const { data, error } = await auth.service.rpc("delete_agent_memory_content", {
      p_workspace_id: auth.workspaceId,
      p_owner_id: auth.userId,
      p_spec_id: validated.data.specId,
      p_memory_id: validated.data.id,
      p_actor_id: auth.userId,
      p_expected_revision: validated.data.revision,
      p_tombstone_ciphertext: tombstone.ciphertext,
      p_tombstone_sha256: tombstone.contentSha256,
      p_tombstone_byte_count: tombstone.contentByteCount,
    });
    const result = data as { status?: string; revision?: number } | null;
    if (error) return fail(503, "memory_authority_unavailable", correlationId);
    if (result?.status === "revision_conflict") return fail(409, "revision_conflict", correlationId);
    if (result?.status === "memory_in_use") return fail(409, "memory_in_use", correlationId);
    if (result?.status === "not_found") return fail(404, "memory_not_found", correlationId);
    if (result?.status === "invalid_request") return fail(400, "invalid_request", correlationId);
    if (result?.status !== "deleted") return fail(400, "invalid_request", correlationId);
    return noStoreJson({
      ok: true,
      id: validated.data.id,
      revision: result.revision,
      requestId: correlationId,
    });
  } catch {
    return fail(503, "memory_authority_unavailable", correlationId);
  }
}
