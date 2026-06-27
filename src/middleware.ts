import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled, ALLOWED_EMAIL_DOMAIN } from "@/lib/supabase/config";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Route gate. In DEMO mode (no Supabase env) it is a no-op — the app is open.
 * In LIVE mode it refreshes the Supabase session and redirects unauthenticated
 * users to /login (Microsoft SSO). /login and /auth/* stay public.
 */
export async function middleware(req: NextRequest) {
  if (!supabaseEnabled) return NextResponse.next();

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
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth");

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
