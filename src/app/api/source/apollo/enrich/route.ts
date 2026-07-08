import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { matchApolloPerson, resolveStoredApolloKey } from "@/lib/sourcing/apollo";

/**
 * Single-person Apollo enrichment (People Enrichment / people/match) — costs
 * exactly 1 Apollo credit on a match, 0 if not found. This route is deliberately
 * separate from /api/source/apollo/search so the UI can only ever fire it on an
 * explicit, confirmed, per-candidate action — never automatically for a whole
 * search batch. The Apollo key is resolved server-side and never returned to the
 * client.
 */
const ApolloEnrichSchema = z.object({
  apolloId: z.string().min(1).max(200),
  revealPhone: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Tighter limit than search — enrichment spends real Apollo credits.
  const rl = checkRateLimit(rateLimitKey(req, "source-apollo-enrich"), { windowMs: 60_000, max: 15 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let session: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    session = await getServerSupabase();
    if (!session) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await session.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const validated = await validateBody(req, ApolloEnrichSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const { apolloId, revealPhone } = validated.data;

  const apiKey = session ? await resolveStoredApolloKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({
      ok: true,
      source: "not_configured",
      email: "",
      phone: "",
      error: "No Apollo key configured. Add a master API key in Settings → API Keys.",
    });
  }

  try {
    const match = await matchApolloPerson(apolloId, apiKey, { revealPhone });
    if (!match) {
      return NextResponse.json({
        ok: true,
        source: "apollo",
        email: "",
        phone: "",
        detail: "No match found for this person (0 credits charged).",
      });
    }
    return NextResponse.json({ ok: true, source: "apollo", email: match.email, phone: match.phone });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Apollo enrichment failed.";
    return NextResponse.json({ ok: false, source: "apollo", error: detail }, { status: 502 });
  }
}
