import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { sendWhatsApp, sendSms } from "@/lib/channels";
import { gateOutbound } from "@/lib/gate";
import { safeLog } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

/**
 * Outbound dispatcher — the ONLY path from messages_outbound to the wire.
 * Runs on a Vercel cron (see vercel.json). Every queued message that is due
 * must clear, in order:
 *   1. an approval row for exactly this message id + body hash (autopilot
 *      writes one when scheduling; a human click writes one in the Replies UI),
 *   2. the human-likeness gate — again, defence in depth,
 *   3. a live seat of the right provider,
 *   4. claim_and_record — the same atomic suppression/re-contact/daily-cap/
 *      de-dupe RPC the interactive send route uses.
 * Anything that fails flips to 'blocked' (human queue) or 'failed' — a message
 * never silently retries into a double-send: the dedupe_hash UNIQUE constraint
 * plus the ledger claim make that impossible.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const supabase = getServiceSupabase();
  if (!supabase) return NextResponse.json({ ok: false, reason: "No service client." }, { status: 503 });

  const { data: due, error: dueErr } = await supabase
    .from("messages_outbound")
    .select("id, workspace_id, spec_id, candidate_id, seat_id, channel, to_address, body")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(10);
  if (dueErr) {
    safeLog("dispatch-outbound: select error", { message: dueErr.message });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let sent = 0, blocked = 0, failed = 0;
  for (const msg of due ?? []) {
    const finish = async (status: "sent" | "blocked" | "failed", gateResult?: unknown) => {
      await supabase
        .from("messages_outbound")
        .update({
          status,
          ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
          ...(gateResult !== undefined ? { gate_result: gateResult } : {}),
        })
        .eq("id", msg.id);
      if (status === "sent") sent++;
      else if (status === "blocked") blocked++;
      else failed++;
    };

    try {
      // 1. Approval must exist for exactly this text.
      const bodyHash = createHash("sha256").update(`\n${msg.body}`).digest("hex");
      const { data: approval } = await supabase
        .from("outreach_approvals")
        .select("body_hash")
        .eq("workspace_id", msg.workspace_id)
        .eq("message_id", msg.id)
        .maybeSingle();
      if (!approval || approval.body_hash !== bodyHash) {
        await finish("blocked", { pass: false, reasons: ["no-approval"] });
        continue;
      }

      // 2. Human-likeness gate, re-run at the wire.
      const gate = gateOutbound(msg.body);
      if (!gate.pass) {
        await finish("blocked", { pass: false, reasons: gate.reasons });
        continue;
      }

      // 3. Live seat of the right provider.
      if (msg.channel !== "WhatsApp" && msg.channel !== "SMS") {
        await finish("blocked", { pass: false, reasons: ["channel-not-dispatchable"] });
        continue;
      }
      const expectedProvider = msg.channel === "WhatsApp" ? "WhatsApp Cloud" : "Twilio SMS";
      const { data: seat } = await supabase
        .from("agent_seats")
        .select("id, provider, status, mode")
        .eq("id", msg.seat_id ?? "")
        .maybeSingle();
      if (!seat || seat.status !== "active" || seat.mode !== "live" || seat.provider !== expectedProvider) {
        await finish("blocked", { pass: false, reasons: ["seat-not-live"] });
        continue;
      }

      // 4. Atomic guardrail claim (suppression, re-contact window, daily cap,
      // de-dupe). The spec id stands in as the campaign scope for agent sends.
      const { data: claim, error: claimErr } = await supabase.rpc("claim_and_record", {
        p_candidate_id: msg.candidate_id,
        p_candidate_email: msg.to_address,
        p_campaign_id: msg.spec_id ?? "agent",
        p_seat_id: seat.id,
        p_channel: msg.channel,
      });
      if (claimErr) {
        safeLog("dispatch-outbound: claim error", { message: claimErr.message });
        await finish("failed");
        continue;
      }
      const claimObj = claim as { allowed?: boolean; reason?: string; ledger_id?: string } | null;
      if (claimObj?.allowed !== true) {
        await finish("blocked", { pass: false, reasons: [`guardrail:${claimObj?.reason ?? "blocked"}`] });
        continue;
      }

      const outcome =
        msg.channel === "WhatsApp"
          ? await sendWhatsApp({ to: msg.to_address, body: msg.body })
          : await sendSms({ to: msg.to_address, body: msg.body });
      if (claimObj.ledger_id) {
        await supabase
          .from("outreach_ledger")
          .update({ status: outcome.status === "sent" ? "sent" : "skipped", reason: outcome.status === "sent" ? null : outcome.detail })
          .eq("id", claimObj.ledger_id);
      }
      await finish(outcome.status === "sent" ? "sent" : "failed");
    } catch (err) {
      safeLog("dispatch-outbound: error", { message: err instanceof Error ? err.message : "unknown" });
      await finish("failed");
    }
  }

  return NextResponse.json({ ok: true, processed: (due ?? []).length, sent, blocked, failed });
}
