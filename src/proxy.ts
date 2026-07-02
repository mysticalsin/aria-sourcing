import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled, ALLOWED_EMAIL_DOMAIN, isProduction, demoLoginEnabled, DEMO_COOKIE_NAME } from "@/lib/supabase/config";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** Routes that must stay reachable without a session: the auth screens and the
 *  public career-site chatbox (external candidates never log in). */
function isPublicPath(path: string): boolean {
  return (
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/careers")
  );
}

/**
 * Route gate. In non-production DEMO mode (no Supabase env) it is a no-op — the
 * app is open for local development. In production with no Supabase env it FAILS
 * CLOSED (503) rather than granting open access. In LIVE mode it refreshes the
 * Supabase session and redirects unauthenticated users to /login (Microsoft SSO).
 * /login and /auth/* stay public.
 */
export async function proxy(req: NextRequest) {
  if (!supabaseEnabled) {
    // Fail CLOSED in production. With no Supabase env the app would run in open
    // DEMO mode (no login gate, every caller treated as admin) — never acceptable
    // in prod. Refuse every matched route with a 503; the matcher already excludes
    // static assets and API routes, so nothing privileged leaks through.
    //
    // The ONE sanctioned exception is a deliberately public, synthetic-data demo
    // (NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true): there the open in-browser DEMO mode IS
    // the intended product, so allow it through.
    if (isProduction && !demoLoginEnabled) {
      return new NextResponse(
        "Service unavailable: server authentication is not configured.",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    // Public demo: gate the app behind the one-click admin/admin login so the
    // env-resident LLM key can't be spent anonymously. Presence check only — the Edge
    // runtime has no node:crypto; the chat route cryptographically verifies the cookie
    // before using the key. /login and /auth/* stay public.
    if (demoLoginEnabled) {
      const path = req.nextUrl.pathname;
      const isAuthRoute = isPublicPath(path);
      const hasSession = req.cookies.has(DEMO_COOKIE_NAME);
      if (!hasSession && !isAuthRoute) {
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("redirect", path);
        return NextResponse.redirect(url);
      }
      if (hasSession && path.startsWith("/login")) {
        const url = req.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
    // Non-production local dev, or a signed-in demo session: serve the app.
    return NextResponse.next();
  }

  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const isAuthRoute = isPublicPath(path);

  if (!user && !isAuthRoute) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  // Enforce the email-domain allow-list when configured (display alone is not a gate).
  if (user && ALLOWED_EMAIL_DOMAIN && !isAuthRoute) {
    const email = (user.email ?? "").toLowerCase();
    if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`)) {
      const url = req.nextUrl.clone();
      url.pathname = "/auth/signout";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (user && path.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // Run on everything except API routes (they return their own JSON status codes),
  // static assets and image files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
