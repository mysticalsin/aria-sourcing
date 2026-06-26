import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from "./config";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Server Supabase client bound to the request cookies. Use in Server Components,
 * Route Handlers, and middleware. Returns null in DEMO mode.
 */
export function getServerSupabase() {
  if (!supabaseEnabled) return null;
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // called from a Server Component — middleware refreshes the session instead
        }
      },
    },
  });
}
