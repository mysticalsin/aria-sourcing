import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { searchApolloPeople, resolveStoredApolloKey, type ApolloPerson } from "@/lib/sourcing/apollo";

/**
 * Real candidate sourcing via Apollo.io's mixed_people/search — free, does not
 * consume Apollo credits. The Apollo key is resolved server-side from the
 * caller's workspace (never accepted from the client body, never returned).
 * When no key is configured the route answers `source: "not_configured"` so
 * the caller can surface an honest "add a key in Settings" message rather than
 * a fake result. Search is synchronous — no polling.
 */
const ApolloSearchSchema = z.object({
  titles: z.array(z.string().min(1).max(120)).max(20).optional(),
  seniorities: z.array(z.string().min(1).max(60)).max(10).optional(),
  locations: z.array(z.string().min(1).max(120)).max(20).optional(),
  organizationDomains: z.array(z.string().min(1).max(200)).max(20).optional(),
  keywords: z.string().max(300).optional(),
  count: z.number().int().min(1).max(50).default(10),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-apollo"), { windowMs: 60_000, max: 10 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  // Live mode: require an authenticated user with the `source` permission. Demo
  // mode (no backend) is open but still rate-limited — though it will always
  // answer "not_configured" since no Apollo key can be persisted without a
  // backend to store it in.
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

  const validated = await validateBody(req, ApolloSearchSchema, { maxBytes: 10_000 });
  if (!validated.ok) return validated.response;
  const { titles, seniorities, locations, organizationDomains, keywords, count = 10 } = validated.data;

  // A stored key only exists once a real backend is configured (demo mode never
  // persists secrets — saveApiKey discards the value after computing last4).
  const apiKey = session ? await resolveStoredApolloKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({
      ok: true,
      source: "not_configured",
      people: [] as ApolloPerson[],
      error: "No Apollo key configured. Add a master API key in Settings → API Keys.",
    });
  }

  try {
    const people = await searchApolloPeople(
      { titles, seniorities, locations, organizationDomains, keywords },
      count,
      apiKey,
    );
    return NextResponse.json({ ok: true, source: "apollo", people });
  } catch (err) {
    // Apollo error bodies never contain the key; keep the client message terse.
    const detail = err instanceof Error ? err.message : "Apollo search failed.";
    return NextResponse.json({ ok: false, source: "apollo", error: detail }, { status: 502 });
  }
}
