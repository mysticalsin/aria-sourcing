import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { handleLinkedInTokenRequest } from "@/channels/linkedin-token/handlers";
import { getLinkedInTokenChannel } from "@/channels/linkedin-token/runtime";
import { supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TEST_WORKSPACE = "synthetic-workspace";

export function linkedInTokenTestSessionOpen(): boolean {
  // The dev bundler rewrites a direct NODE_ENV read, so the key is built at runtime.
  const env = process["env"] as Record<string, string | undefined>;
  const NODE_ENV = env[["NODE", "ENV"].join("_")];
  return NODE_ENV === "test" && process.env.ARIA_LINKEDIN_TOKEN_TEST_SESSION === "1";
}

async function caller(): Promise<{ userId: string | null; role: string; workspaceId: string | null }> {
  if (linkedInTokenTestSessionOpen()) {
    const jar = await cookies();
    const role = jar.get("aria_e2e_role")?.value;
    if (role === "admin" || role === "owner" || role === "member" || role === "viewer") {
      return { userId: "e2e-user", role, workspaceId: TEST_WORKSPACE };
    }
    return { userId: null, role: "", workspaceId: null };
  }
  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) return { userId: null, role: "", workspaceId: null };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { userId: null, role: "", workspaceId: null };
    const { data: role } = await supabase.rpc("current_profile_role");
    const name = role === "admin" || role === "owner" || role === "viewer" || role === "member" ? role : "";
    if (!name) return { userId: user.id, role: "", workspaceId: null };
    const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", user.id).maybeSingle();
    const workspaceId = typeof profile?.workspace_id === "string" ? profile.workspace_id : null;
    if (!workspaceId) return { userId: null, role: "", workspaceId: null };
    return { userId: user.id, role: name, workspaceId };
  }
  return { userId: null, role: "", workspaceId: null };
}

function closed(): NextResponse {
  return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const who = await caller();
  if (!who.userId || !who.workspaceId || !who.role) return who.userId && !who.role ? NextResponse.json({ ok: false, reason: "role" }, { status: 403, headers: { "cache-control": "no-store" } }) : closed();
  const requested = req.nextUrl.searchParams.get("workspaceId");
  if (requested && requested !== who.workspaceId) {
    return NextResponse.json({ ok: false, reason: "workspace" }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const result = await handleLinkedInTokenRequest({
    method: "GET",
    role: who.role,
    userId: who.userId,
    sessionWorkspaceId: who.workspaceId,
    workspaceId: who.workspaceId,
    channel: getLinkedInTokenChannel(),
    e2e: linkedInTokenTestSessionOpen(),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const who = await caller();
  if (!who.userId || !who.workspaceId || !who.role) {
    if (who.userId && !who.role) {
      return NextResponse.json({ ok: false, reason: "role" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload.action !== "string" || JSON.stringify(payload).length > 16_384) {
    return NextResponse.json({ ok: false, reason: "action" }, { status: 400 });
  }
  if (typeof payload.workspaceId === "string" && payload.workspaceId !== who.workspaceId) {
    return NextResponse.json({ ok: false, reason: "workspace" }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const result = await handleLinkedInTokenRequest({
    method: "POST",
    role: who.role,
    userId: who.userId,
    sessionWorkspaceId: who.workspaceId,
    workspaceId: who.workspaceId,
    channel: getLinkedInTokenChannel(),
    action: payload.action,
    body: payload,
    e2e: linkedInTokenTestSessionOpen(),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
