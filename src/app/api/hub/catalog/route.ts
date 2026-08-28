import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { listHubRoles, publicHubProjection, type HubLocale } from "@/lib/candidate-hub";

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

/** Public catalog of candidate hubs (no auth). */
export async function GET(req: NextRequest) {
  const limit = checkRateLimit(rateLimitKey(req, "hub-catalog"), { windowMs: 60_000, max: 120 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const locale = localeFrom(req);
  const hubs = listHubRoles().map((role) => publicHubProjection(role, locale));
  return NextResponse.json(
    {
      ok: true,
      callingExcluded: true,
      screeningMode: "async_text",
      hubs,
    },
    { headers: NO_STORE },
  );
}
