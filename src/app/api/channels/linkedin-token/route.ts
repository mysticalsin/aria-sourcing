import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { handleLinkedInTokenRequest } from "@/channels/linkedin-token/handlers";
import { getLinkedInTokenChannel } from "@/channels/linkedin-token/runtime";
import { supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const WORKSPACE = "synthetic-workspace";

async function caller(): Promise<{ role: string; actorId: string }> {
  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) return { role: "member", actorId: "anonymous" };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { role: "member", actorId: "anonymous" };
    const { data: role } = await supabase.rpc("current_profile_role");
    const name = role === "admin" || role === "owner" ? role : "member";
    return { role: name, actorId: user.id };
  }
  if (process.env.ARIA_E2E === "1") {
    const jar = await cookies();
    const role = jar.get("aria_e2e_role")?.value;
    if (role === "admin" || role === "owner" || role === "member" || role === "viewer") {
      return { role, actorId: "e2e-user" };
    }
  }
  return { role: "member", actorId: "local-demo" };
}

export async function GET(req: NextRequest) {
  const who = await caller();
  const result = await handleLinkedInTokenRequest({
    method: "GET",
    role: who.role,
    workspaceId: req.nextUrl.searchParams.get("workspaceId") ?? WORKSPACE,
    channel: getLinkedInTokenChannel(),
    e2e: process.env.ARIA_E2E === "1",
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const who = await caller();
  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload.action !== "string") {
    return NextResponse.json({ ok: false, reason: "action" }, { status: 400 });
  }
  if (process.env.ARIA_E2E === "1" && (payload.action === "kill" || payload.action === "reset")) {
    process.env.ARIA_SEND_KILL_SWITCH = payload.action === "kill" ? "on" : "off";
  }
  const result = await handleLinkedInTokenRequest({
    method: "POST",
    role: who.role,
    actorId: who.actorId,
    workspaceId: typeof payload.workspaceId === "string" ? payload.workspaceId : WORKSPACE,
    channel: getLinkedInTokenChannel(),
    action: payload.action,
    body: { ...payload, actorId: who.actorId },
    e2e: process.env.ARIA_E2E === "1",
  } as Parameters<typeof handleLinkedInTokenRequest>[0]);
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
