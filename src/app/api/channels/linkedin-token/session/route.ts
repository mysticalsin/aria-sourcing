import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const ROLES = new Set(["admin", "owner", "member", "viewer"]);

function testSessionOpen(): boolean {
  // The dev bundler rewrites a direct NODE_ENV read, so the key is built at runtime.
  const env = process["env"] as Record<string, string | undefined>;
  const NODE_ENV = env[["NODE", "ENV"].join("_")];
  return NODE_ENV === "test" && process.env.ARIA_LINKEDIN_TOKEN_TEST_SESSION === "1";
}

function closed(): NextResponse {
  return NextResponse.json({ ok: false, reason: "disabled" }, { status: 404 });
}

export async function GET() {
  if (!testSessionOpen()) return closed();
  const jar = await cookies();
  const role = jar.get("aria_e2e_role")?.value;
  return NextResponse.json({ ok: true, role: ROLES.has(role ?? "") ? role : "member", e2e: true });
}

export async function POST(req: NextRequest) {
  if (!testSessionOpen()) return closed();
  const payload = (await req.json().catch(() => null)) as { role?: string } | null;
  const role = payload?.role ?? "";
  if (!ROLES.has(role)) return NextResponse.json({ ok: false, reason: "role" }, { status: 400 });
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set("aria_e2e_role", role, { httpOnly: true, sameSite: "lax", path: "/", secure: false });
  return response;
}
