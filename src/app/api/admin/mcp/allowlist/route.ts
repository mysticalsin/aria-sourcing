import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

const UpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    baseUrl: z.string().url().refine((value) => value.startsWith("https://"), {
      message: "MCP baseUrl must be https.",
    }),
    toolManifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    encryptedSecretId: z.string().uuid().nullable().optional(),
    maxTools: z.number().int().min(1).max(16).default(16),
    enabled: z.boolean(),
  })
  .strict();

const DisableSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

/** GET — list allowlist rows for the current workspace (admin). */
export async function GET(req: NextRequest) {
  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  if (!session) return noStoreJson({ ok: false, error: "Supabase is not configured." }, 503);
  if (!can("admin", "manage_tools")) return noStoreJson({ ok: false, error: "Admins only." }, 403);

  const { data: auth } = await session.auth.getUser();
  const actorId = auth.user?.id;
  if (!actorId) return noStoreJson({ ok: false, error: "Not authenticated." }, 401);

  const limit = checkRateLimit(rateLimitKey(req, "mcp-allowlist-list", actorId), {
    windowMs: 60_000,
    max: 60,
  });
  if (!limit.ok) {
    const response = noStoreJson({ ok: false, error: "Rate limited." }, 429);
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }

  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string") {
    return noStoreJson({ ok: false, error: "Workspace unresolved." }, 403);
  }

  const listed = await session
    .from("mcp_server_allowlist")
    .select("id,name,base_url,base_url_host,tool_manifest_sha256,max_tools,enabled,updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (listed.error) return noStoreJson({ ok: false, error: "Allowlist unavailable." }, 503);
  return noStoreJson({ ok: true, entries: listed.data ?? [] });
}

/** POST — upsert an allowlist entry. */
export async function POST(req: NextRequest) {
  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  if (!session) return noStoreJson({ ok: false, error: "Supabase is not configured." }, 503);

  const { data: auth } = await session.auth.getUser();
  const actorId = auth.user?.id;
  if (!actorId) return noStoreJson({ ok: false, error: "Not authenticated." }, 401);

  const limit = checkRateLimit(rateLimitKey(req, "mcp-allowlist-upsert", actorId), {
    windowMs: 60_000,
    max: 20,
  });
  if (!limit.ok) {
    const response = noStoreJson({ ok: false, error: "Rate limited." }, 429);
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }

  const body = await validateBody(req, UpsertSchema, { maxBytes: 8_000 });
  if (!body.ok) return body.response;

  const result = await session.rpc("upsert_mcp_allowlist_entry", {
    p_name: body.data.name,
    p_base_url: body.data.baseUrl,
    p_tool_manifest_sha256: body.data.toolManifestSha256,
    p_encrypted_secret_id: body.data.encryptedSecretId ?? null,
    p_max_tools: body.data.maxTools,
    p_enabled: body.data.enabled,
  });

  if (result.error) return noStoreJson({ ok: false, error: "Allowlist upsert failed." }, 503);
  const payload = result.data as { status?: string; id?: string } | null;
  if (!payload || payload.status !== "ok") {
    return noStoreJson({ ok: false, error: "Allowlist upsert rejected.", status: payload?.status }, 400);
  }
  return noStoreJson({ ok: true, id: payload.id });
}

/** DELETE — disable an allowlist entry (body: { id }). */
export async function DELETE(req: NextRequest) {
  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  if (!session) return noStoreJson({ ok: false, error: "Supabase is not configured." }, 503);

  const { data: auth } = await session.auth.getUser();
  const actorId = auth.user?.id;
  if (!actorId) return noStoreJson({ ok: false, error: "Not authenticated." }, 401);

  const body = await validateBody(req, DisableSchema, { maxBytes: 2_000 });
  if (!body.ok) return body.response;

  const result = await session.rpc("disable_mcp_allowlist_entry", { p_id: body.data.id });
  if (result.error) return noStoreJson({ ok: false, error: "Allowlist disable failed." }, 503);
  const payload = result.data as { status?: string } | null;
  if (!payload || payload.status !== "ok") {
    const status = payload?.status === "not_found" ? 404 : 400;
    return noStoreJson({ ok: false, error: "Allowlist disable rejected.", status: payload?.status }, status);
  }
  return noStoreJson({ ok: true, id: body.data.id });
}

/** Helper exported for tests: stable tool-manifest fingerprint. */
export function hashToolManifest(tools: Array<{ name: string; description?: string }>): string {
  const normalized = tools
    .map((tool) => `${tool.name}:${tool.description ?? ""}`)
    .sort()
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}
