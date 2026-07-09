import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { parseCareersWorkspaceId } from "@/lib/careers-server";
import {
  loadPublicCareerJobs,
  submitPublicCareerApplication,
  type CareerWorkspaceRepository,
} from "@/lib/careers-service";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

const AnswerSchema = z
  .object({
    kind: z.enum(["mobility", "visa", "keyexp", "toolexp", "project", "quickmatch"]),
    answer: z.string().trim().min(1).max(160).optional(),
    stars: z.number().int().min(1).max(5).optional(),
    question: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const CareerApplicationSchema = z
  .object({
    path: z.enum(["A", "B"]),
    campaignId: z.string().trim().min(1).max(120).nullable(),
    roleTitle: z.string().trim().min(1).max(160),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(6).max(32),
    cvFileName: z.string().trim().min(1).max(180).optional(),
    detected: z
      .object({
        location: z.string().trim().min(1).max(160).optional(),
        nationality: z.string().trim().min(1).max(100).optional(),
        phoneCountry: z.string().trim().min(1).max(16).optional(),
        skills: z.array(z.string().trim().min(1).max(100)).max(5).optional(),
      })
      .strict(),
    answers: z.array(AnswerSchema).min(1).max(10),
    contactPref: z
      .object({
        time: z.string().trim().min(1).max(40).optional(),
        day: z.string().trim().min(1).max(40).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function limitedResponse(retryAfterSec: number): Response {
  const response = tooManyRequests(retryAfterSec);
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}

function configuredWorkspaceId(): string | null {
  return parseCareersWorkspaceId(process.env.CAREERS_WORKSPACE_ID);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serviceRepository(): CareerWorkspaceRepository | null {
  try {
    const supabase = getServiceSupabase();
    if (!supabase) return null;
    return {
      async load(workspaceId) {
        const { data, error } = await supabase
          .from("workspace_state")
          .select("state, updated_at")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (error || !data || !isRecord(data.state) || typeof data.updated_at !== "string") return null;
        return { state: data.state, updatedAt: data.updated_at };
      },
      async compareAndSet(workspaceId, expectedUpdatedAt, state) {
        const { data, error } = await supabase
          .from("workspace_state")
          .update({ state })
          .eq("workspace_id", workspaceId)
          .eq("updated_at", expectedUpdatedAt)
          .select("updated_at")
          .maybeSingle();
        return !error && Boolean(data);
      },
    };
  } catch {
    // Missing production configuration is intentionally indistinguishable from
    // an unavailable service to anonymous candidates.
    return null;
  }
}

/** Returns only jobs deliberately published for the explicitly configured tenant. */
export async function GET(req: NextRequest) {
  const workspaceId = configuredWorkspaceId();
  if (!workspaceId) return json({ ok: false }, 503);

  const limit = checkRateLimit(rateLimitKey(req, "careers-public-read"), { windowMs: 60_000, max: 120 });
  if (!limit.ok) return limitedResponse(limit.retryAfterSec);

  const repository = serviceRepository();
  if (!repository) return json({ ok: false }, 503);
  try {
    const jobs = await loadPublicCareerJobs(repository, workspaceId);
    if (!jobs) return json({ ok: false }, 503);
    return json({ ok: true, jobs });
  } catch {
    return json({ ok: false }, 503);
  }
}

/** Accept a bounded application without authenticating or hydrating a workspace in the browser. */
export async function POST(req: NextRequest) {
  const workspaceId = configuredWorkspaceId();
  if (!workspaceId) return json({ ok: false }, 503);

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return json({ ok: false }, 415);
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) return json({ ok: false }, 403);

  const limit = checkRateLimit(rateLimitKey(req, "careers-public-submit"), { windowMs: 15 * 60_000, max: 5 });
  if (!limit.ok) return limitedResponse(limit.retryAfterSec);

  const validated = await validateBody(req, CareerApplicationSchema, { maxBytes: 16_000 });
  if (!validated.ok) {
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) validated.response.headers.set(key, value);
    return validated.response;
  }

  const repository = serviceRepository();
  if (!repository) return json({ ok: false }, 503);
  try {
    const result = await submitPublicCareerApplication(repository, workspaceId, validated.data);
    if (result === "accepted") return json({ ok: true }, 201);
    if (result === "duplicate") return json({ ok: true }, 202);
    if (result === "invalid") return json({ ok: false }, 409);
    return json({ ok: false }, 503);
  } catch {
    return json({ ok: false }, 503);
  }
}
