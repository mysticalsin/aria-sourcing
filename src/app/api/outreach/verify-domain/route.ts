import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { domainVerified } from "@/lib/domain-verification";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";

// Bare hostname only — labels of 1-63 alphanumerics/hyphens (no leading/trailing
// hyphen), at least one dot. Rejects URLs (no scheme/path chars allowed) and
// email addresses (no "@") by construction rather than by denylist.
const HOSTNAME_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+$/;

const VerifyDomainSchema = z.object({
  seatId: z.string().uuid(),
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(HOSTNAME_RE, "Enter a bare domain (e.g. mail.example.com), not a URL or email address."),
});

/**
 * Verify a sending domain's SPF/DKIM/DMARC DNS records BEFORE a seat is allowed
 * to go live. This is the only path that lets an operator flip a seat's
 * `domain_verified` flag ahead of send time — mirrors the same DNS check the
 * send route (`/api/outreach/send`) otherwise only runs lazily on first live
 * send. `domainVerified` itself does the real DNS lookups; this route just
 * gates who may trigger it and persists the result.
 */
export async function POST(req: NextRequest) {
  // Fail closed in production (middleware doesn't cover /api/*): never serve the
  // open demo path unauthenticated.
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Tight rate limit — this endpoint does real DNS lookups per call.
  const rl = checkRateLimit(rateLimitKey(req, "outreach-verify-domain"), { windowMs: 60_000, max: 5 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, VerifyDomainSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const { seatId, domain } = validated.data;

  // DEMO mode: no enforcement backend to persist against, but the DNS check
  // itself is real — let the operator see a genuine result, just don't persist.
  if (!supabaseEnabled) {
    const verified = await domainVerified(domain);
    return NextResponse.json({ ok: true, verified });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    const verified = await domainVerified(domain);
    return NextResponse.json({ ok: true, verified });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  // Authorization: same `outreach` permission the approve/send routes require.
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "outreach")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  // Seat must belong to the caller's workspace (RLS) — same lookup shape as the
  // send route's seat check.
  const { data: seat, error: seatErr } = await supabase
    .from("agent_seats")
    .select("id")
    .eq("id", seatId)
    .maybeSingle();
  if (seatErr || !seat) {
    return NextResponse.json({ ok: false, error: "Seat not found in your workspace." }, { status: 403 });
  }

  const verified = await domainVerified(domain);
  if (verified) {
    await supabase.from("agent_seats").update({ domain_verified: true }).eq("id", seatId);
  }
  return NextResponse.json({ ok: true, verified });
}
