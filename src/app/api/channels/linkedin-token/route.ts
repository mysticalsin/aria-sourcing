import { NextResponse, type NextRequest } from "next/server";

import { handleLinkedInTokenRequest } from "@/channels/linkedin-token/handlers";
import { getLinkedInTokenChannel } from "@/channels/linkedin-token/runtime";
import { linkedInTokenCaller, linkedInTokenTestSessionOpen } from "./caller";

export const dynamic = "force-dynamic";

export { linkedInTokenTestSessionOpen };

function closed(): NextResponse {
  return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const who = await linkedInTokenCaller();
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
  const who = await linkedInTokenCaller();
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
