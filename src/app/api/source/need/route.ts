import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { runFixtureSourcing } from "@/lib/fixtures/trading-platform-need";
import {
  FIXTURE_NOT_ON_LIVE,
  FIXTURE_NOT_ON_LIVE_PATHS,
} from "@/lib/sourcing/lab-fixture-people";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import {
  configuredLiveProviders,
  runSourcingEngine,
  SHORTLIST_CAP,
  type CandidateEvidence,
} from "@/lib/sourcing/engine";
import { DEMO_COOKIE_NAME, demoLoginEnabled, prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Aria sourcing engine: need in, scored shortlist out.
 * Contract: docs/sourcing-engine/DESIGN.md
 */

const LiveEvidenceSchema = z
  .object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    skills: z.array(z.string().max(80)).max(40),
    cvText: z.string().max(20_000),
    linkedinText: z.string().max(20_000),
    yearsExperience: z.number().int().min(0).max(60).nullable(),
    provenance: z.literal("live"),
  })
  .strict();

const NeedSchema = z
  .object({
    jd: z.string().max(20_000).optional(),
    email: z.string().max(20_000).optional(),
    pdfBase64: z.string().max(400_000).optional(),
    mode: z.enum(["fixture", "live"]).default("fixture"),
    count: z.number().int().min(1).max(SHORTLIST_CAP).default(SHORTLIST_CAP),
    liveEvidence: z.array(LiveEvidenceSchema).max(200).optional(),
  })
  .strict();

function publicDemoDenied(req: NextRequest): Response | null {
  if (supabaseEnabled || !demoLoginEnabled) return null;
  if (demoAuthConfigured() && verifyDemoToken(req.cookies.get(DEMO_COOKIE_NAME)?.value)) return null;
  return NextResponse.json({ ok: false, code: "UNAUTHORIZED", requestId: randomUUID() }, { status: 401 });
}

function liveOriginDenied(req: NextRequest): Response | null {
  if (!supabaseEnabled) return null;
  const origin = req.headers.get("origin");
  if (origin === req.nextUrl.origin) return null;
  return NextResponse.json(
    { ok: false, code: "CROSS_ORIGIN_REQUEST", requestId: randomUUID() },
    { status: 403 },
  );
}

function decodePdf(base64: string | undefined): Uint8Array | undefined {
  if (!base64?.trim()) return undefined;
  try {
    return new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const demoBlock = publicDemoDenied(req);
  if (demoBlock) return demoBlock;
  const originBlock = liveOriginDenied(req);
  if (originBlock) return originBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-need"), { windowMs: 60_000, max: 10 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) {
      return NextResponse.json({ ok: false, code: "DEPENDENCY_UNAVAILABLE", requestId: randomUUID() }, { status: 500 });
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED", requestId: randomUUID() }, { status: 401 });
    }
    const { data: role } = await supabase.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, code: "FORBIDDEN", requestId: randomUUID() }, { status: 403 });
    }
  }

  const validated = await validateBody(req, NeedSchema, { maxBytes: 450_000 });
  if (!validated.ok) return validated.response;
  const { jd, email, pdfBase64, mode, count, liveEvidence } = validated.data;
  const requestId = randomUUID();
  const pdfBytes = decodePdf(pdfBase64);

  if (mode === "fixture" && supabaseEnabled) {
    return NextResponse.json(
      {
        ok: false,
        code: FIXTURE_NOT_ON_LIVE,
        requestId,
        paths: [...FIXTURE_NOT_ON_LIVE_PATHS],
      },
      { status: 409 },
    );
  }

  if (mode === "live") {
    const providers = configuredLiveProviders();
    if (providers.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "PROVIDER_NOT_CONFIGURED",
          requestId,
          paths: [
            "Connect Apify in Access & Keys and switch the card to Live.",
            "Add a live provider key (Apollo, Sillage, Seamless, Apify, or GitHub) in Settings.",
            "Paste the JD and score CVs Aria already holds — do not invent live people.",
          ],
        },
        { status: 503 },
      );
    }
    const pool = (liveEvidence ?? []) as CandidateEvidence[];
    if (pool.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "LIVE_EVIDENCE_REQUIRED",
          requestId,
          providers,
          paths: [
            "Search via the existing /api/source providers, then POST provenance:live evidence here.",
            "Connect Apify in Access & Keys and switch the card to Live — do not hydrate lab fixtures.",
            "Paste the JD and score CVs Aria already holds.",
          ],
        },
        { status: 409 },
      );
    }
    const run = runSourcingEngine({ jd, email, pdfBytes, mode: "live", count, pool });
    if (!run.ok) {
      return NextResponse.json({ ok: false, code: run.code, requestId, paths: run.paths ?? null }, { status: 422 });
    }
    return NextResponse.json({ ok: true, requestId, mode: run.mode, ...run.result });
  }

  const run = runFixtureSourcing({ jd, email, pdfBytes, count });
  if (!run.ok) {
    const status = run.code === "OCR_REQUIRED" || run.code === "PROVIDER_NOT_CONFIGURED" ? 503 : 422;
    return NextResponse.json({ ok: false, code: run.code, requestId, paths: run.paths ?? null }, { status });
  }
  return NextResponse.json({ ok: true, requestId, mode: run.mode, ...run.result });
}
