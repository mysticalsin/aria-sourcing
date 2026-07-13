import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { experimentalPaidSourcingEnabled, supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { searchSeamlessContacts, resolveStoredSeamlessKey, type SeamlessContact } from "@/lib/sourcing/seamless";

/**
 * Real candidate sourcing via Seamless.AI's search/contacts. Search returns
 * named profiles with no email/phone (a separate, explicitly confirmed
 * research call reveals those — see /api/source/seamless/research). The
 * Seamless key is resolved server-side from the caller's workspace, never
 * accepted from the client body, never returned. Search is synchronous — no
 * polling needed here (only the research/reveal step is async).
 */
const SeamlessSearchSchema = z.object({
  jobTitles: z.array(z.string().min(1).max(120)).max(10).optional(),
  seniorities: z.array(z.string().min(1).max(60)).max(5).optional(),
  departments: z.array(z.string().min(1).max(60)).max(5).optional(),
  industries: z.array(z.string().min(1).max(120)).max(5).optional(),
  countries: z.array(z.string().min(1).max(120)).max(10).optional(),
  states: z.array(z.string().min(1).max(120)).max(10).optional(),
  companyNames: z.array(z.string().min(1).max(200)).max(100).optional(),
  companyDomains: z.array(z.string().min(1).max(200)).max(100).optional(),
  count: z.number().int().min(1).max(100).default(25),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!experimentalPaidSourcingEnabled) {
    return NextResponse.json(
      { ok: false, source: "disabled", error: "Seamless is unavailable until server-owned provider receipts are enabled." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rl = checkRateLimit(rateLimitKey(req, "source-seamless"), { windowMs: 60_000, max: 10 });
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

  const validated = await validateBody(req, SeamlessSearchSchema, { maxBytes: 10_000 });
  if (!validated.ok) return validated.response;
  const { count = 25, ...filters } = validated.data;

  const apiKey = session ? await resolveStoredSeamlessKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({
      ok: true,
      source: "not_configured",
      contacts: [] as SeamlessContact[],
      error: "No Seamless key configured. Add an API key in Settings → API Keys.",
    });
  }

  try {
    const contacts = await searchSeamlessContacts(filters, count, apiKey);
    return NextResponse.json({ ok: true, source: "seamless", contacts });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Seamless search failed.";
    return NextResponse.json({ ok: false, source: "seamless", error: detail }, { status: 502 });
  }
}
