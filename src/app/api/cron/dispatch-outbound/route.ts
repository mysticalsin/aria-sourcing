import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { dispatchDue } from "@/lib/dispatch-outbound";
import { recoverPendingWhatsAppInbound } from "@/lib/whatsapp-inbound";

export const dynamic = "force-dynamic";

/**
 * Daily backstop for the outbound dispatcher (Vercel Hobby allows only daily
 * crons). The primary drain is opportunistic: /api/webhooks/whatsapp calls
 * dispatchDue() after every inbound event. All send-side guardrails live in
 * src/lib/dispatch-outbound.ts.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const supabase = getServiceSupabase();
  if (!supabase) return NextResponse.json({ ok: false, reason: "No service client." }, { status: 503 });

  const inboundRecovery = await recoverPendingWhatsAppInbound(supabase, 50);
  const stats = await dispatchDue(supabase, 50);
  return NextResponse.json({ ok: true, ...stats, inboundRecovery });
}
