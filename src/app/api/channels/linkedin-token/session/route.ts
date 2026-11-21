import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const ROLES = new Set(["admin", "owner", "member", "viewer"]);

export async function GET() {
  if (process.env.ARIA_E2E !== "1") {
    return NextResponse.json({ ok: true, role: "member", e2e: false });
  }
  const jar = await cookies();
  const role = jar.get("aria_e2e_role")?.value;
  return NextResponse.json({ ok: true, role: ROLES.has(role ?? "") ? role : "member", e2e: true });
}

export async function POST(req: NextRequest) {
  if (process.env.ARIA_E2E !== "1") {
    return NextResponse.json({ ok: false, reason: "disabled" }, { status: 404 });
  }
  const payload = (await req.json().catch(() => null)) as { role?: string } | null;
  const role = payload?.role ?? "";
  if (!ROLES.has(role)) return NextResponse.json({ ok: false, reason: "role" }, { status: 400 });
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set("aria_e2e_role", role, { httpOnly: true, sameSite: "lax", path: "/", secure: false });
  return response;
}
