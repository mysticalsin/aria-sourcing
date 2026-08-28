import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { getHubRole, publicHubProjection, type HubLocale } from "@/lib/candidate-hub";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

function localeFrom(req: NextRequest): HubLocale {
  const raw = (req.nextUrl.searchParams.get("locale") ?? "fr").toLowerCase();
  if (raw === "en" || raw === "es" || raw === "fr") return raw;
  return "fr";
}

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const limit = checkRateLimit(rateLimitKey(req, "hub-slug"), { windowMs: 60_000, max: 120 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const { slug } = await ctx.params;
  const role = getHubRole(slug);
  if (!role) {
    return NextResponse.json({ ok: false, error: "hub_not_found" }, { status: 404, headers: NO_STORE });
  }
  const locale = localeFrom(req);
  return NextResponse.json(
    { ok: true, hub: publicHubProjection(role, locale) },
    { headers: NO_STORE },
  );
}
