import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { startProfileSearchRun, resolveStoredApifyKey } from "@/lib/sourcing/apify";
import { loadSourcingCampaign } from "@/lib/sourcing/campaign-context";
import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";

export const runtime = "nodejs";

/**
 * Real candidate sourcing via Apify's harvestapi/linkedin-profile-search actor —
 * starts the async run and returns immediately with a runId + datasetId; the
 * caller polls /api/source/apify/status for the result. Mirrors the
 * start/status split in /api/source/sillage/*. The Apify token is read
 * server-side from the caller's workspace (never accepted from the client
 * body, never returned).
 */
const ApifyStartSchema = z
  .object({
    campaignId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    searchQuery: z.string().min(1).max(300).optional(),
    profileScraperMode: z.enum(["Short", "Full", "Full + email search"]).optional(),
    maxItems: z.number().int().min(1).max(50).optional(),
    takePages: z.number().int().min(1).max(100).optional(),
    startPage: z.number().int().min(1).optional(),
    locations: z.array(z.string().min(1).max(120)).max(20).optional(),
    currentJobTitles: z.array(z.string().min(1).max(120)).max(20).optional(),
    pastJobTitles: z.array(z.string().min(1).max(120)).max(20).optional(),
    currentCompanies: z.array(z.string().min(1).max(200)).max(20).optional(),
    pastCompanies: z.array(z.string().min(1).max(200)).max(20).optional(),
    schools: z.array(z.string().min(1).max(200)).max(20).optional(),
    firstNames: z.array(z.string().min(1).max(120)).max(20).optional(),
    lastNames: z.array(z.string().min(1).max(120)).max(20).optional(),
  })
  .refine(
    (d) =>
      Boolean(d.searchQuery?.trim()) ||
      [
        d.locations,
        d.currentJobTitles,
        d.pastJobTitles,
        d.currentCompanies,
        d.pastCompanies,
        d.schools,
        d.firstNames,
        d.lastNames,
      ].some((arr) => arr && arr.length > 0),
    { message: "Provide a searchQuery or at least one filter.", path: ["searchQuery"] },
  );

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-apify-start"), { windowMs: 60_000, max: 10 });
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

  const validated = await validateBody(req, ApifyStartSchema, { maxBytes: 4_000 });
  if (!validated.ok) return validated.response;
  const { campaignId, ...input } = validated.data;

  // A stored key only exists once a real backend is configured (demo mode never
  // persists secrets — saveApiKey discards the value after computing last4).
  const apiKey = session ? await resolveStoredApifyKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Connect an Apify key in Settings first." });
  }

  if (!session) return NextResponse.json({ ok: false, error: "Campaign authority is unavailable." }, { status: 503 });
  const campaign = await loadSourcingCampaign(session, campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  const clearance = clearDiscoveryCriteria(
    "Apify",
    {
      searchQuery: input.searchQuery ?? "",
      locations: input.locations ?? [],
      currentJobTitles: input.currentJobTitles ?? [],
      pastJobTitles: input.pastJobTitles ?? [],
      currentCompanies: input.currentCompanies ?? [],
      pastCompanies: input.pastCompanies ?? [],
      schools: input.schools ?? [],
      firstNames: input.firstNames ?? [],
      lastNames: input.lastNames ?? [],
    },
    campaign,
  );
  if (!clearance.ok) return NextResponse.json({ ok: false, error: clearance.error }, { status: 422 });

  const result = await startProfileSearchRun(clearance.clearance, apiKey, input);
  if (!result.ok) {
    // A network-level failure (status 0) reports as 502, matching /api/source's
    // upstream-error convention; a real Apify status (401 bad token, 429, ...)
    // passes through so the client sees the honest cause.
    return NextResponse.json(
      { ok: false, status: result.status, error: result.detail || result.title },
      { status: result.status || 502 },
    );
  }
  return NextResponse.json({ ok: true, runId: result.data.runId, datasetId: result.data.datasetId });
}
