import { headers as serverOnlyBoundary } from "next/headers";
import type { NextRequest } from "next/server";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { DEMO_COOKIE_NAME, demoLoginEnabled, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  principalFromEvidence,
  type AuthenticatedPrincipal,
} from "@/lib/authenticated-principal-policy";

void serverOnlyBoundary;

export type PrincipalResolution =
  | { ok: true; principal: AuthenticatedPrincipal }
  | { ok: false; status: 401 | 503; error: "authentication_required" | "authentication_unavailable" };

/** Resolve a billable API caller without exposing session material to callers. */
export async function resolveAuthenticatedPrincipal(req: NextRequest): Promise<PrincipalResolution> {
  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) return { ok: false, status: 503, error: "authentication_unavailable" };
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return { ok: false, status: 401, error: "authentication_required" };
    return {
      ok: true,
      principal: principalFromEvidence({ supabaseUserId: user.id, signedDemoSession: false })!,
    };
  }

  const signedDemoSession =
    demoLoginEnabled &&
    demoAuthConfigured() &&
    verifyDemoToken(req.cookies.get(DEMO_COOKIE_NAME)?.value);
  const principal = principalFromEvidence({ supabaseUserId: null, signedDemoSession });
  return principal
    ? { ok: true, principal }
    : { ok: false, status: 401, error: "authentication_required" };
}
