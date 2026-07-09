import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

const RevokeSchema = z.object({
  messageId: z.string().min(1).max(120),
});

/**
 * Revoke a recorded human approval before delivery claims its irreversible
 * ledger slot. The database function is idempotent for absent/already-revoked
 * rows and returns a conflict once a live delivery has already begun.
 */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: false, error: "No backend configured." }, { status: 503 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "outreach-revoke"), { windowMs: 60_000, max: 60 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "outreach")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const validated = await validateBody(req, RevokeSchema);
  if (!validated.ok) return validated.response;
  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", persisted: false, detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }
  const { data, error } = await supabase.rpc("revoke_outreach_approval", {
    p_message_id: validated.data.messageId,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || result?.ok !== true) {
    if (result?.reason === "already-dispatching") {
      return NextResponse.json({ ok: false, error: "This message has already entered delivery." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "Could not revoke approval." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
