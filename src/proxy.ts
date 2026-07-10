import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_AUTH_COOKIE_NAME, SUPABASE_URL, supabaseEnabled, ALLOWED_EMAIL_DOMAIN, isProduction, demoLoginEnabled, DEMO_COOKIE_NAME } from "@/lib/supabase/config";
import { verifyDemoTokenAtEdge } from "@/lib/demo-auth-edge";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** Routes that must stay reachable without a session: the auth screens and the
 *  public career-site chatbox (external candidates never log in). */
function isPublicPath(path: string): boolean {
  return (
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/careers") ||
    path.startsWith("/unsubscribe")
  );
}

/** API handlers that authenticate with a provider signature/bearer or are
 * deliberately public. They must remain reachable without a demo session. */
function isPublicServiceApi(path: string): boolean {
  return (
    path === "/api/health" ||
    path === "/api/auth/demo-login" ||
    path.startsWith("/api/careers") ||
    path.startsWith("/api/unsubscribe/") ||
    path.startsWith("/api/webhooks/") ||
    path.startsWith("/api/cron/")
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
  const requestPath = req.nextUrl.pathname;
  const apiRequest = requestPath === "/api" || requestPath.startsWith("/api/");
  if (!supabaseEnabled) {
    const validDemoSession = demoLoginEnabled
      ? await verifyDemoTokenAtEdge(req.cookies.get(DEMO_COOKIE_NAME)?.value, process.env.DEMO_SESSION_SECRET)
      : false;
    // Preserve each API handler's own JSON auth, provider-signature, cron-secret,
    // public, or liveness contract. This is the same ownership boundary APIs had
    // before they were added to the matcher for live-session domain enforcement.
    if (apiRequest) {
      if (!demoLoginEnabled || isPublicServiceApi(requestPath)) return NextResponse.next();
      if (!validDemoSession) {
        return NextResponse.json(
          { ok: false, reason: "Sign in to use this demo API." },
          { status: 401 },
        );
      }
      return NextResponse.next();
    }
    // Fail CLOSED in production. With no Supabase env the app would run in open
    // DEMO mode (no login gate, every caller treated as admin) — never acceptable
    // in prod. Refuse every matched route with a 503; only static assets are
    // excluded from this gate.
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
    // Public demo: gate the app behind the one-click admin/admin login. The
    // Web Crypto verifier works in the Edge runtime, so a forged cookie name is
    // not enough to reach either pages or non-public APIs.
    if (demoLoginEnabled) {
      const path = requestPath;
      const isAuthRoute = isPublicPath(path);
      const hasSession = validDemoSession;
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
    cookieOptions: { name: SUPABASE_AUTH_COOKIE_NAME },
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

  const path = requestPath;
  const isAuthRoute = isPublicPath(path);
  const isApiRoute = apiRequest;

  // API handlers keep their own JSON authentication or signature contract.
  // The shared gate applies organization membership whenever a session exists,
  // but does not redirect anonymous API clients to an HTML login page.
  if (!user && !isAuthRoute && !isApiRoute) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  // Enforce the email-domain allow-list when configured (display alone is not a gate).
  if (user && ALLOWED_EMAIL_DOMAIN && !isAuthRoute) {
    const email = (user.email ?? "").toLowerCase();
    if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`)) {
      if (isApiRoute) {
        return NextResponse.json(
          { ok: false, reason: "Email domain is not authorized." },
          { status: 403 },
        );
      }
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
  // API routes are included so an authenticated off-domain session cannot
  // bypass the organization gate. Static assets and image files stay excluded.
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
