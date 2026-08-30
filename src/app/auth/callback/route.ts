import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { publicOrigin } from "@/lib/public-origin";

/** Normalize an OAuth continuation to an unambiguous path on this origin.
 * WHATWG treats backslashes as slashes for special schemes, so a string such
 * as `/\\evil.example/path` is effectively protocol-relative. Validate both
 * decoded representations and the URL parser's final origin before redirecting. */
function sameOriginRedirect(raw: string, origin: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";

  let decoded = raw;
  for (let pass = 0; pass < 3; pass += 1) {
    if (decoded.includes("\\") || decoded.startsWith("//")) return "/";
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return "/";
    }
  }

  try {
    const target = new URL(raw, origin);
    if (target.origin !== origin || target.username || target.password) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

/** OAuth redirect target. Exchanges the Microsoft auth code for a session cookie. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const origin = publicOrigin(req.headers);
  // Only allow same-origin relative paths — never an absolute or protocol-relative
  // URL (open-redirect guard).
  const rawRedirect = url.searchParams.get("redirect") || "/";
  const redirect = sameOriginRedirect(rawRedirect, origin);
  const supabase = await getServerSupabase();

  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const fail = new URL("/login", origin);
      fail.searchParams.set("error", "Sign-in failed. Please try again.");
      return NextResponse.redirect(fail);
    }
  }

  return NextResponse.redirect(new URL(redirect, origin));
}
