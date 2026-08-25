import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { DEMO_COOKIE_NAME } from "@/lib/supabase/config";
import { publicOrigin } from "@/lib/public-origin";

async function handle(req: NextRequest) {
  const supabase = await getServerSupabase();
  if (supabase) await supabase.auth.signOut();
  const origin = publicOrigin(req.headers);
  const res = NextResponse.redirect(new URL("/login", origin));
  // Clear the open-demo session cookie too, so logout truly returns to the login gate.
  res.cookies.set(DEMO_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}

export const GET = handle;
export const POST = handle;
