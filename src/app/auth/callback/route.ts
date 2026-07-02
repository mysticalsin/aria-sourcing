import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/** OAuth redirect target. Exchanges the Microsoft auth code for a session cookie. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  // Only allow same-origin relative paths — never an absolute or protocol-relative
  // URL (open-redirect guard).
  const rawRedirect = url.searchParams.get("redirect") || "/";
  const redirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/";
  const supabase = await getServerSupabase();

  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const fail = new URL("/login", url.origin);
      fail.searchParams.set("error", "Sign-in failed. Please try again.");
      return NextResponse.redirect(fail);
    }
  }

  return NextResponse.redirect(new URL(redirect, url.origin));
}
