import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readBoundedBody } from "@/lib/api/validate";
import {
  checkRateLimit,
  rateLimitKey,
  type RateLimitResult,
} from "@/lib/rate-limit";

const MAX_BODY_BYTES = 131_072;
const MAX_PAST_AGE_MS = 5 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 30 * 1_000;
const CREDENTIAL_KEY_RE = /^aria_need_v1_[A-Za-z0-9_-]{43}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const TIMESTAMP_RE = /^\d{10}$/;
const PRE_AUTH_THROTTLE = { windowMs: 60_000, max: 20 } as const;

const NeedIngressPayloadSchema = z
  .object({
    need: z
      .object({
        content: z.string().trim().min(20).max(100_000),
        contentType: z.enum(["text/plain", "text/markdown", "application/json"]),
      })
      .strict()
      .superRefine((need, context) => {
        if (need.contentType !== "application/json") return;
        try {
          const value: unknown = JSON.parse(need.content);
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["content"],
              message: "JSON need content must be an object.",
            });
          }
        } catch {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["content"],
            message: "JSON need content must be an object.",
          });
        }
      }),
  })
  .strict();

const ActiveCredentialSchema = z
  .object({
    status: z.literal("active"),
    credential_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
  })
  .strict();

const MissingCredentialSchema = z
  .object({ status: z.literal("not_found") })
  .strict();

const AcceptedResultSchema = z
  .object({
    status: z.literal("accepted"),
    requisition_id: z.string().uuid(),
    job_id: z.string().uuid(),
    replay: z.boolean(),
  })
  .strict();

const RefusedResultSchema = z
  .object({
    status: z.enum([
      "intake_disabled",
      "idempotency_conflict",
      "invalid_request",
      "inconsistent_state",
      "credential_inactive",
    ]),
  })
  .strict();

export interface NeedIngressRpcClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
}

export interface NeedIngressDependencies {
  now?: () => number;
  sharedThrottleConfigured: boolean;
  checkPreAuthThrottle?: (req: Request) => RateLimitResult;
  getServiceClient: () => NeedIngressRpcClient | null;
}

type NeedIngressEnvironment = {
  NODE_ENV?: string;
  ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED?: string;
  ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256?: string;
  FLY_APP_NAME?: string;
};

/**
 * Production ingress is enabled only by an activation-generated evidence
 * digest paired with the explicit shared-throttle flag. A bare boolean is not
 * authority. The local limiter below remains a per-process safety net and is
 * not represented as shared protection.
 */
export function needIngressSharedThrottleConfigured(
  environment: NeedIngressEnvironment = process.env,
): boolean {
  return environment.NODE_ENV !== "production"
    || (
      environment.ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED === "true"
      && SHA256_RE.test(
        environment.ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256 ?? "",
      )
    );
}

/**
 * Bound unauthenticated work before any service client or database RPC exists.
 * The bucket is based on trusted network identity, not the presented credential,
 * so an attacker cannot mint a fresh bucket by inventing credential keys.
 */
export function checkNeedIngressPreAuthThrottle(
  req: Request,
  environment: NeedIngressEnvironment = process.env,
): RateLimitResult {
  const flyClientIp = req.headers.get("fly-client-ip")?.trim() ?? "";
  const key = environment.FLY_APP_NAME && isIP(flyClientIp)
    ? `need-ingress-preauth:${flyClientIp}:anon`
    : rateLimitKey(req, "need-ingress-preauth");
  return checkRateLimit(key, PRE_AUTH_THROTTLE);
}

/**
 * The signed material is versioned and newline-delimited. The timestamp and
 * idempotency key are authenticated alongside the exact raw request body, so
 * neither replay control can be changed independently of the payload.
 */
export function needIngressSigningPayload(
  timestamp: string,
  idempotencyKey: string,
  rawBody: string,
): string {
  return `aria-need-v1\n${timestamp}\n${idempotencyKey}\n${rawBody}`;
}

function authenticationFailed() {
  return NextResponse.json(
    { ok: false, reason: "Authentication failed." },
    { status: 401 },
  );
}

function unavailable(reason = "Need ingress is unavailable.") {
  return NextResponse.json(
    { ok: false, reason },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function rateLimited(retryAfterSec: number) {
  const retry = Math.max(1, Math.ceil(retryAfterSec));
  return NextResponse.json(
    { ok: false, error: "rate_limited" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retry),
      },
    },
  );
}

function verifySignature(
  rawBody: string,
  timestamp: string,
  idempotencyKey: string,
  presentedSignature: string,
  secret: string,
): boolean {
  const signatureMatch = SIGNATURE_RE.exec(presentedSignature);
  if (!signatureMatch) return false;

  const expected = createHmac("sha256", secret)
    .update(needIngressSigningPayload(timestamp, idempotencyKey, rawBody), "utf8")
    .digest();
  const presented = Buffer.from(signatureMatch[1], "hex");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/**
 * Authenticate, validate, and hand one need to the database transaction that
 * owns both requisition persistence and first-job enqueue. This function does
 * not call a model, a sourcing provider, or any outbound delivery path.
 */
export async function handleNeedIngressRequest(
  req: NextRequest,
  dependencies: NeedIngressDependencies,
): Promise<NextResponse> {
  let preAuthThrottle: RateLimitResult;
  try {
    preAuthThrottle = (dependencies.checkPreAuthThrottle ?? checkNeedIngressPreAuthThrottle)(req);
  } catch {
    return unavailable();
  }
  if (!preAuthThrottle.ok) return rateLimited(preAuthThrottle.retryAfterSec);
  if (!dependencies.sharedThrottleConfigured) return unavailable();

  const credentialKey = req.headers.get("x-aria-need-key")?.trim() ?? "";
  const timestamp = req.headers.get("x-aria-need-timestamp")?.trim() ?? "";
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
  const presentedSignature = req.headers.get("x-aria-need-signature")?.trim() ?? "";
  if (
    !CREDENTIAL_KEY_RE.test(credentialKey)
    || !TIMESTAMP_RE.test(timestamp)
    || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)
    || !SIGNATURE_RE.test(presentedSignature)
  ) {
    return authenticationFailed();
  }

  const requestTimeMs = Number(timestamp) * 1_000;
  const nowMs = (dependencies.now ?? Date.now)();
  const ageMs = nowMs - requestTimeMs;
  if (
    !Number.isSafeInteger(requestTimeMs)
    || ageMs > MAX_PAST_AGE_MS
    || ageMs < -MAX_FUTURE_SKEW_MS
  ) {
    return authenticationFailed();
  }

  let rawBody: string;
  try {
    rawBody = await readBoundedBody(req, MAX_BODY_BYTES);
  } catch {
    return NextResponse.json({ ok: false, reason: "Body too large." }, { status: 413 });
  }

  if (!verifySignature(
    rawBody,
    timestamp,
    idempotencyKey,
    presentedSignature,
    credentialKey,
  )) {
    return authenticationFailed();
  }

  const mediaType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ ok: false, reason: "Content-Type must be application/json." }, { status: 415 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid payload." }, { status: 400 });
  }
  const parsed = NeedIngressPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "Invalid payload." }, { status: 400 });
  }

  let serviceClient: NeedIngressRpcClient | null;
  try {
    serviceClient = dependencies.getServiceClient();
  } catch {
    return unavailable();
  }
  if (!serviceClient) return unavailable();

  const keySha256 = createHash("sha256").update(credentialKey, "utf8").digest("hex");
  let resolveResponse: Awaited<ReturnType<NeedIngressRpcClient["rpc"]>>;
  try {
    resolveResponse = await serviceClient.rpc("resolve_need_ingress_credential", {
      p_key_sha256: keySha256,
    });
  } catch {
    return unavailable("Need ingress could not be completed.");
  }
  if (resolveResponse.error) {
    return unavailable("Need ingress could not be completed.");
  }

  const resolved = ActiveCredentialSchema.safeParse(resolveResponse.data);
  if (!resolved.success) {
    if (MissingCredentialSchema.safeParse(resolveResponse.data).success) {
      return authenticationFailed();
    }
    return unavailable("Need ingress could not be completed.");
  }

  let rpcResponse: Awaited<ReturnType<NeedIngressRpcClient["rpc"]>>;
  try {
    rpcResponse = await serviceClient.rpc("ingest_requisition_with_credential", {
      p_credential_id: resolved.data.credential_id,
      p_key_sha256: keySha256,
      p_source_ref: idempotencyKey,
      p_need_content: parsed.data.need.content,
      p_content_type: parsed.data.need.contentType,
    });
  } catch {
    return unavailable("Need ingress could not be completed.");
  }
  if (rpcResponse.error) {
    return unavailable("Need ingress could not be completed.");
  }

  const accepted = AcceptedResultSchema.safeParse(rpcResponse.data);
  if (accepted.success) {
    return NextResponse.json(
      {
        ok: true,
        requisitionId: accepted.data.requisition_id,
        jobId: accepted.data.job_id,
        replay: accepted.data.replay,
      },
      { status: accepted.data.replay ? 200 : 202 },
    );
  }

  const refused = RefusedResultSchema.safeParse(rpcResponse.data);
  if (!refused.success) {
    return unavailable("Need ingress could not be completed.");
  }
  if (refused.data.status === "credential_inactive") {
    return authenticationFailed();
  }
  if (refused.data.status === "intake_disabled") {
    return NextResponse.json(
      { ok: false, reason: "Need intake is disabled." },
      { status: 423 },
    );
  }
  if (refused.data.status === "idempotency_conflict") {
    return NextResponse.json(
      { ok: false, reason: "Idempotency key conflict." },
      { status: 409 },
    );
  }
  if (refused.data.status === "invalid_request") {
    return NextResponse.json({ ok: false, reason: "Invalid request." }, { status: 400 });
  }
  return unavailable("Need ingress could not be completed.");
}
