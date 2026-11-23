import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { LINKEDIN_TOKEN_TEST_WORKSPACE, linkedInTokenCaller, linkedInTokenTestSessionOpen } from "../caller";

export const dynamic = "force-dynamic";

const ROLES = new Set(["admin", "owner", "member", "viewer"]);

function closed(): NextResponse {
  return NextResponse.json({ ok: false, reason: "disabled" }, { status: 404 });
}

export async function GET() {
  if (linkedInTokenTestSessionOpen()) {
    const jar = await cookies();
    const role = jar.get("aria_e2e_role")?.value;
    return NextResponse.json(
      {
        ok: true,
        role: ROLES.has(role ?? "") ? role : "member",
        workspaceId: LINKEDIN_TOKEN_TEST_WORKSPACE,
        e2e: true,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const who = await linkedInTokenCaller();
  if (!who.userId || !who.workspaceId) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  if (!who.role) {
    return NextResponse.json({ ok: false, reason: "role" }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(
    { ok: true, role: who.role, workspaceId: who.workspaceId, e2e: false },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (!linkedInTokenTestSessionOpen()) return closed();
  const payload = (await req.json().catch(() => null)) as { role?: string } | null;
  const role = payload?.role ?? "";
  if (!ROLES.has(role)) return NextResponse.json({ ok: false, reason: "role" }, { status: 400 });
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set("aria_e2e_role", role, { httpOnly: true, sameSite: "lax", path: "/", secure: false });
  return response;
}
