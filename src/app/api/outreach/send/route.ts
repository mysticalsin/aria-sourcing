import { NextResponse, type NextRequest } from "next/server";
import { sendViaProvider, type SendRequest } from "@/lib/providers";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";

/**
 * Outreach send endpoint — safe by construction.
 *
 * A real send happens ONLY when ALL hold:
 *   1. Supabase is configured (the server-side guardrail backend exists).
 *   2. The caller has an authenticated session.
 *   3. The named seat belongs to the caller's workspace, is `live`, and has a
 *      verified domain. The From address is taken from the SEAT, never the body.
 *   4. `claim_and_record` (the Postgres RPC) allows it — enforcing suppression,
 *      the re-contact window, the per-seat daily cap, and atomic de-dupe.
 *   5. `confirmLive` is explicitly true.
 * Anything else degrades to dry-run. In DEMO mode there is no enforcement
 * backend, so the route NEVER sends — it always returns dry-run.
 */
export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ status: "error", detail: "Invalid JSON body." }, { status: 400 });
  }

  const seatId = String(payload.seatId ?? "");
  const candidateId = String(payload.candidateId ?? "");
  const candidateEmail = String(payload.candidateEmail ?? payload.to ?? "");
  const campaignId = String(payload.campaignId ?? "");
  const subject = String(payload.subject ?? "");
  const body = String(payload.body ?? "");
  const confirmLive = payload.confirmLive === true;

  if (!subject || !body || !candidateEmail) {
    return NextResponse.json({ status: "error", detail: "Missing required fields." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidateEmail)) {
    return NextResponse.json({ status: "error", detail: "Invalid recipient address." }, { status: 400 });
  }

  // DEMO mode: no server-side guardrails → never send.
  if (!supabaseEnabled || !confirmLive) {
    return NextResponse.json({
      status: "dry-run",
      detail: !supabaseEnabled
        ? "Demo mode — no enforcement backend. Nothing sent."
        : "Dry-run — confirmLive not set. Nothing sent.",
    });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ status: "dry-run", detail: "No Supabase client — dry-run." });
  }

  // 2. Require an authenticated session.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ status: "error", detail: "Not authenticated." }, { status: 401 });
  }
  if (!seatId) {
    return NextResponse.json({ status: "error", detail: "Missing seatId." }, { status: 400 });
  }

  // 3. Seat must belong to the caller's workspace (RLS), be live + domain-verified.
  const { data: seat, error: seatErr } = await supabase
    .from("agent_seats")
    .select("id, provider, operator_email, mode, domain_verified, status")
    .eq("id", seatId)
    .maybeSingle();
  if (seatErr || !seat) {
    return NextResponse.json({ status: "error", detail: "Seat not found in your workspace." }, { status: 403 });
  }
  if (seat.status !== "active") {
    return NextResponse.json({ status: "skipped", detail: "Seat is not active." });
  }
  if (seat.mode !== "live" || !seat.domain_verified) {
    return NextResponse.json({ status: "dry-run", detail: "Seat not live / domain unverified — dry-run." });
  }

  // 4. Atomic guardrail claim in Postgres (suppression + window + cap + de-dupe).
  const { data: claim, error: claimErr } = await supabase.rpc("claim_and_record", {
    p_candidate_id: candidateId,
    p_candidate_email: candidateEmail,
    p_campaign_id: campaignId,
    p_seat_id: seatId,
    p_channel: "Email",
  });
  if (claimErr) {
    return NextResponse.json({ status: "error", detail: `Guardrail check failed: ${claimErr.message}` }, { status: 500 });
  }
  const claimObj = claim as { allowed?: boolean; reason?: string; ledger_id?: string } | null;
  if (claimObj?.allowed !== true) {
    return NextResponse.json({ status: "skipped", detail: `Guardrail blocked: ${claimObj?.reason ?? "blocked by guardrails"}` });
  }
  // The claim is recorded as 'claimed' (holds the de-dupe slot). We reconcile it to
  // 'sent' or 'skipped' after the provider actually responds — so a failed send is
  // retryable and never counts as contacted.
  const ledgerId = claimObj.ledger_id;
  const reconcile = async (status: "sent" | "skipped", reason: string | null) => {
    if (ledgerId) await supabase.from("outreach_ledger").update({ status, reason }).eq("id", ledgerId);
  };

  // 5. Send — From is the SEAT's verified mailbox, never the request body.
  try {
    const outcome = await sendViaProvider({
      provider: seat.provider as SendRequest["provider"],
      from: seat.operator_email,
      to: candidateEmail,
      subject,
      body,
    });
    if (outcome.status === "sent") await reconcile("sent", null);
    else await reconcile("skipped", outcome.detail); // dry-run / provider error → free the slot
    return NextResponse.json(outcome);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Send failed.";
    await reconcile("skipped", detail);
    return NextResponse.json({ status: "error", detail }, { status: 500 });
  }
}
