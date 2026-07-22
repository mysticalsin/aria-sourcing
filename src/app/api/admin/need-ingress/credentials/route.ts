import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { classifySameOriginJsonRequest } from "@/lib/api/same-origin-json";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import {
  getServerSupabase,
  getServiceSupabase,
  requireAdmin,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUIDSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const LabelSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => value === value.trim(), "Label must not have surrounding whitespace.")
  .refine((value) => new TextEncoder().encode(value).byteLength <= 100, "Label is too long.")
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value), "Label contains control characters.");

const CreateSchema = z
  .object({
    label: LabelSchema,
    keySha256: Sha256Schema,
    expiresAt: TimestampSchema,
    requestId: UUIDSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const now = Date.now();
    const expiresAt = Date.parse(value.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Expiration must be in the future.",
      });
    } else if (expiresAt > now + 90 * 24 * 60 * 60 * 1_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Expiration cannot exceed 90 days.",
      });
    }
  });

const RevokeSchema = z
  .object({
    credentialId: UUIDSchema,
    requestId: UUIDSchema,
  })
  .strict();

const CredentialRowSchema = z
  .object({
    id: UUIDSchema,
    label: LabelSchema,
    status: z.enum(["active", "revoked"]),
    expires_at: TimestampSchema,
    created_at: TimestampSchema,
    revoked_at: TimestampSchema.nullable(),
  })
  .strict();

const CreateSuccessSchema = z
  .object({
    status: z.literal("created"),
    replay: z.boolean(),
    credential_id: UUIDSchema,
    workspace_id: UUIDSchema,
    label: LabelSchema,
    expires_at: TimestampSchema,
    receipt_sha256: Sha256Schema,
  })
  .strict();
const CreateRefusalSchema = z
  .object({
    status: z.enum([
      "invalid_request",
      "idempotency_conflict",
      "key_conflict",
      "workspace_conflict",
      "active_limit_reached",
    ]),
  })
  .strict();

const RevokeSuccessSchema = z
  .object({
    status: z.literal("revoked"),
    replay: z.boolean(),
    credential_id: UUIDSchema,
    workspace_id: UUIDSchema,
    receipt_sha256: Sha256Schema,
  })
  .strict();
const RevokeRefusalSchema = z
  .object({
    status: z.enum([
      "invalid_request",
      "idempotency_conflict",
      "not_found",
      "already_revoked",
      "workspace_conflict",
    ]),
  })
  .strict();

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
type AdminContext =
  | {
      ok: true;
      session: ServerSupabase;
      workspaceId: string;
      userId: string;
    }
  | { ok: false; response: NextResponse };

type ErrorCode =
  | "NOT_AUTHENTICATED"
  | "INSUFFICIENT_PERMISSIONS"
  | "CROSS_ORIGIN_REQUEST"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NEED_INGRESS_AUTHORITY_CHANGED"
  | "NEED_INGRESS_CREDENTIAL_LIMIT_REACHED"
  | "NEED_INGRESS_CREDENTIALS_UNAVAILABLE";

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

function fail(status: number, code: ErrorCode, error: string, retryAfter?: number): NextResponse {
  const response = noStoreJson({ ok: false, code, error }, status);
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

function mutationBoundary(req: NextRequest): NextResponse | null {
  const result = classifySameOriginJsonRequest(req);
  if (result === "unsupported_media_type") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  if (result === "cross_origin_request") {
    return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin credential changes are not allowed.");
  }
  return null;
}

async function adminContext(): Promise<AdminContext> {
  if (prodFailClosed() || !supabaseEnabled) {
    return {
      ok: false,
      response: fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Need ingress credentials are unavailable."),
    };
  }
  const session = await getServerSupabase();
  if (!session) {
    return {
      ok: false,
      response: fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Need ingress credentials are unavailable."),
    };
  }
  const admin = await requireAdmin(session);
  if (!admin.ok) {
    if (admin.response.status === 401) {
      return { ok: false, response: fail(401, "NOT_AUTHENTICATED", "Authentication is required.") };
    }
    if (admin.response.status === 403) {
      return { ok: false, response: fail(403, "INSUFFICIENT_PERMISSIONS", "Administrator permission is required.") };
    }
    return {
      ok: false,
      response: fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Need ingress credentials are unavailable."),
    };
  }

  const {
    data: { user },
    error: userError,
  } = await session.auth.getUser();
  if (userError || !user || !UUIDSchema.safeParse(user.id).success) {
    return { ok: false, response: fail(401, "NOT_AUTHENTICATED", "Authentication is required.") };
  }
  const { data, error } = await session.rpc("current_workspace_id");
  const workspace = UUIDSchema.safeParse(data);
  if (error || !workspace.success) {
    return {
      ok: false,
      response: fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Workspace authority could not be resolved."),
    };
  }
  return { ok: true, session, workspaceId: workspace.data, userId: user.id };
}

function enforceRateLimit(req: NextRequest, scope: string, userId: string, max: number): NextResponse | null {
  const result = checkRateLimit(rateLimitKey(req, scope, userId), { windowMs: 60_000, max });
  return result.ok
    ? null
    : fail(429, "RATE_LIMITED", "Need ingress credential rate limit reached.", result.retryAfterSec);
}

export async function GET(req: NextRequest) {
  try {
    const context = await adminContext();
    if (!context.ok) return context.response;
    const limited = enforceRateLimit(req, "admin-need-ingress-credentials-read", context.userId, 60);
    if (limited) return limited;

    const service = getServiceSupabase();
    if (!service) {
      return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Need ingress credentials are unavailable.");
    }
    const { data, error } = await service
      .from("need_ingress_credentials")
      .select("id,label,status,expires_at,created_at,revoked_at")
      .eq("workspace_id", context.workspaceId)
      .order("status", { ascending: true })
      .order("expires_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Need ingress credentials could not be loaded.");
    }
    const parsed = z.array(CredentialRowSchema).max(100).safeParse(data);
    if (!parsed.success) {
      return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Need ingress credential metadata is invalid.");
    }

    // This read crosses RLS through the service client after the initial admin
    // check. Revalidate immediately before disclosure so a concurrent role or
    // workspace change cannot expose metadata from the former tenant.
    const current = await adminContext();
    if (!current.ok) return current.response;
    if (current.userId !== context.userId || current.workspaceId !== context.workspaceId) {
      return fail(
        409,
        "NEED_INGRESS_AUTHORITY_CHANGED",
        "Need ingress credential authority changed during the request.",
      );
    }
    return noStoreJson({
      ok: true,
      credentials: parsed.data.map((row) => ({
        id: row.id,
        label: row.label,
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
      })),
    });
  } catch {
    return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Need ingress credentials are unavailable.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const boundary = mutationBoundary(req);
    if (boundary) return boundary;
    const context = await adminContext();
    if (!context.ok) return context.response;
    const limited = enforceRateLimit(req, "admin-need-ingress-credentials-create", context.userId, 10);
    if (limited) return limited;

    const validated = await validateBody(req, CreateSchema, { maxBytes: 2_000 });
    if (!validated.ok) {
      return fail(validated.response.status, "INVALID_REQUEST", "Invalid credential creation request.");
    }
    const { data, error } = await context.session.rpc("create_need_ingress_credential", {
      p_label: validated.data.label,
      p_key_sha256: validated.data.keySha256,
      p_expires_at: validated.data.expiresAt,
      p_request_id: validated.data.requestId,
      p_expected_workspace_id: context.workspaceId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : 503;
      const code = status === 403 ? "INSUFFICIENT_PERMISSIONS" : "NEED_INGRESS_CREDENTIALS_UNAVAILABLE";
      return fail(status, code, status === 403 ? "Administrator permission is required." : "Credential creation failed.");
    }

    const created = CreateSuccessSchema.safeParse(data);
    if (created.success) {
      if (created.data.workspace_id !== context.workspaceId) {
        return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Credential creation returned invalid authority metadata.");
      }
      return noStoreJson(
        {
          ok: true,
          status: "created",
          replay: created.data.replay,
          credential: {
            id: created.data.credential_id,
            label: created.data.label,
            status: "active",
            expiresAt: created.data.expires_at,
          },
          receiptSha256: created.data.receipt_sha256,
        },
        created.data.replay ? 200 : 201,
      );
    }
    const refused = CreateRefusalSchema.safeParse(data);
    if (!refused.success) {
      return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Credential creation returned invalid metadata.");
    }
    if (refused.data.status === "invalid_request") {
      return fail(400, "INVALID_REQUEST", "Invalid credential creation request.");
    }
    if (refused.data.status === "workspace_conflict") {
      return fail(409, "NEED_INGRESS_AUTHORITY_CHANGED", "Need ingress credential authority changed during the request.");
    }
    if (refused.data.status === "active_limit_reached") {
      return fail(409, "NEED_INGRESS_CREDENTIAL_LIMIT_REACHED", "Active need ingress credential limit reached.");
    }
    return fail(409, "CONFLICT", "Credential creation conflicts with existing authority.");
  } catch {
    return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Credential creation failed.");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const boundary = mutationBoundary(req);
    if (boundary) return boundary;
    const context = await adminContext();
    if (!context.ok) return context.response;
    const limited = enforceRateLimit(req, "admin-need-ingress-credentials-revoke", context.userId, 20);
    if (limited) return limited;

    const validated = await validateBody(req, RevokeSchema, { maxBytes: 2_000 });
    if (!validated.ok) {
      return fail(validated.response.status, "INVALID_REQUEST", "Invalid credential revocation request.");
    }
    const { data, error } = await context.session.rpc("revoke_need_ingress_credential", {
      p_credential_id: validated.data.credentialId,
      p_request_id: validated.data.requestId,
      p_expected_workspace_id: context.workspaceId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : 503;
      const code = status === 403 ? "INSUFFICIENT_PERMISSIONS" : "NEED_INGRESS_CREDENTIALS_UNAVAILABLE";
      return fail(status, code, status === 403 ? "Administrator permission is required." : "Credential revocation failed.");
    }

    const revoked = RevokeSuccessSchema.safeParse(data);
    if (revoked.success) {
      if (revoked.data.workspace_id !== context.workspaceId) {
        return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Credential revocation returned invalid authority metadata.");
      }
      return noStoreJson({
        ok: true,
        status: "revoked",
        replay: revoked.data.replay,
        credentialId: revoked.data.credential_id,
        receiptSha256: revoked.data.receipt_sha256,
      });
    }
    const refused = RevokeRefusalSchema.safeParse(data);
    if (!refused.success) {
      return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Credential revocation returned invalid metadata.");
    }
    if (refused.data.status === "invalid_request") {
      return fail(400, "INVALID_REQUEST", "Invalid credential revocation request.");
    }
    if (refused.data.status === "not_found") {
      return fail(404, "NOT_FOUND", "Credential not found.");
    }
    if (refused.data.status === "workspace_conflict") {
      return fail(409, "NEED_INGRESS_AUTHORITY_CHANGED", "Need ingress credential authority changed during the request.");
    }
    return fail(409, "CONFLICT", "Credential revocation conflicts with existing authority.");
  } catch {
    return fail(503, "NEED_INGRESS_CREDENTIALS_UNAVAILABLE", "Credential revocation failed.");
  }
}
