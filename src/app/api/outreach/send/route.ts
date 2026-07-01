import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { sendViaProvider, type SendRequest } from "@/lib/providers";
import { sendViaGmailApi, sendViaMicrosoftGraph } from "@/lib/email-oauth";
import { domainVerified } from "@/lib/domain-verification";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import type { EmailConnection, Role } from "@/lib/types";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";
import { sendWhatsApp, sendSms } from "@/lib/channels";
import { encryptSecret, decryptSecret } from "@/lib/crypto-secrets";

/**
 * Strip CR/LF and other control characters from a value bound for an email header
 * (the Subject). The Gmail/Graph MIME builder joins headers with `\r\n`, so an
 * unescaped newline in the subject would inject arbitrary headers or body —
 * classic SMTP/MIME header injection. Subjects are single-line: collapse control
 * chars and runs of whitespace to a single space.
 */
function sanitizeHeader(value: string): string {
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OutreachSendSchema = z.object({
  seatId: z.string().uuid().optional(),
  messageId: z.string().min(1).max(120),
  candidateId: z.string().min(1).max(120),
  candidateEmail: z.string().email().max(255).optional(),
  to: z.string().email().max(255).optional(),
  campaignId: z.string().min(1).max(120),
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(50_000),
  channel: z.enum(["Email", "LinkedIn", "WhatsApp", "SMS"]).default("Email"),
  phone: z.string().max(40).optional(),
  confirmLive: z.boolean().default(false),
});

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
  // Fail closed in production (middleware doesn't cover /api/*): never serve the
  // open demo path — which could spend provider keys unauthenticated or treat
  // every caller as admin when Supabase env is absent.
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Rate limit (defence-in-depth) before any work: blunt abuse and runaway send
  // loops on this provider-touching endpoint. Per-IP sliding window.
  const rl = checkRateLimit(rateLimitKey(req, "outreach-send"), { windowMs: 60_000, max: 30 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, OutreachSendSchema, { maxBytes: 100_000 });
  if (!validated.ok) return validated.response;
  const payload = validated.data;

  const seatId = payload.seatId ?? "";
  const candidateId = payload.candidateId;
  const candidateEmail = payload.candidateEmail ?? payload.to ?? "";
  const campaignId = payload.campaignId;
  const body = payload.body;
  // Strip CR/LF + control chars from the subject to prevent header/MIME injection.
  const subject = sanitizeHeader(payload.subject);
  const { confirmLive } = payload;

  // DEMO mode: no server-side guardrails → never send.
  if (!supabaseEnabled || !confirmLive) {
    return NextResponse.json({
      status: "dry-run",
      detail: !supabaseEnabled
        ? "Demo mode — no enforcement backend. Nothing sent."
        : "Dry-run — confirmLive not set. Nothing sent.",
    });
  }

  const supabase = await getServerSupabase();
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
  // Authorization: a real send requires the `outreach` permission (viewers are read-only).
  const { data: senderRole } = await supabase.rpc("current_profile_role");
  if (!can(senderRole as Role, "outreach")) {
    return NextResponse.json({ status: "error", detail: "Insufficient permissions." }, { status: 403 });
  }

  // Approval gate (server-side): a real send requires a recorded human approval of
  // THIS exact message (by id + sha256 of subject+body). Without a matching
  // approval the endpoint refuses — closing the bypass where a direct API call
  // could send an unapproved message. Approvals are written by /api/outreach/approve.
  const { data: approvalWid } = await supabase.rpc("current_workspace_id");
  const approvalHash = createHash("sha256").update(`${payload.subject}\n${body}`).digest("hex");
  const { data: approval } = await supabase
    .from("outreach_approvals")
    .select("body_hash")
    .eq("workspace_id", approvalWid)
    .eq("message_id", payload.messageId)
    .maybeSingle();
  if (!approval || approval.body_hash !== approvalHash) {
    return NextResponse.json(
      { status: "error", detail: "Message not human-approved (or changed since approval)." },
      { status: 403 },
    );
  }

  if (!seatId) {
    return NextResponse.json({ status: "error", detail: "Missing seatId." }, { status: 400 });
  }

  // Phone channels (WhatsApp / SMS): deliver via the channel adapter using the
  // candidate's phone. Self-contained branch — skips the email-only steps (domain
  // verification, email connection) but keeps auth, the approval gate above, and the
  // atomic guardrail claim. The email/LinkedIn path below is unchanged.
  if (payload.channel === "WhatsApp" || payload.channel === "SMS") {
    const phone = (payload.phone ?? "").trim();
    if (!phone) {
      return NextResponse.json({ status: "skipped", detail: "No phone number on file for this candidate." });
    }
    const { data: phoneSeat } = await supabase
      .from("agent_seats")
      .select("id, provider, status, mode")
      .eq("id", seatId)
      .maybeSingle();
    if (!phoneSeat) {
      return NextResponse.json({ status: "error", detail: "Seat not found in your workspace." }, { status: 403 });
    }
    if (phoneSeat.mode !== "live") {
      return NextResponse.json({ status: "dry-run", detail: "Seat not live — nothing sent." });
    }
    const expectedProvider = payload.channel === "WhatsApp" ? "WhatsApp Cloud" : "Twilio SMS";
    if (phoneSeat.provider !== expectedProvider) {
      return NextResponse.json({ status: "skipped", detail: `Seat is not a ${expectedProvider} sender.` });
    }

    // Atomic guardrail claim (re-contact window + per-seat cap + de-dupe by candidate).
    const { data: pClaim, error: pClaimErr } = await supabase.rpc("claim_and_record", {
      p_candidate_id: candidateId,
      p_candidate_email: phone,
      p_campaign_id: campaignId,
      p_seat_id: seatId,
      p_channel: payload.channel,
    });
    if (pClaimErr) {
      safeLog("claim_and_record error", { message: pClaimErr.message, code: pClaimErr.code });
      return NextResponse.json({ status: "error", detail: "Guardrail check failed." }, { status: 500 });
    }
    const pClaimObj = pClaim as { allowed?: boolean; reason?: string; ledger_id?: string } | null;
    if (pClaimObj?.allowed !== true) {
      return NextResponse.json({ status: "skipped", detail: `Guardrail blocked: ${pClaimObj?.reason ?? "blocked by guardrails"}` });
    }
    const pLedgerId = pClaimObj.ledger_id;
    const pReconcile = async (status: "sent" | "skipped", reason: string | null) => {
      if (pLedgerId) await supabase.from("outreach_ledger").update({ status, reason }).eq("id", pLedgerId);
    };

    try {
      const outcome =
        payload.channel === "WhatsApp"
          ? await sendWhatsApp({ to: phone, body })
          : await sendSms({ to: phone, body });
      if (outcome.status === "sent") await pReconcile("sent", null);
      else await pReconcile("skipped", outcome.detail);
      return NextResponse.json(outcome);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Send failed.";
      await pReconcile("skipped", detail);
      return NextResponse.json({ status: "error", detail }, { status: 500 });
    }
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

  // 3b. Server-side suppression / do-not-contact gate — enforced BEFORE any send
  // and before the atomic claim. `suppression_list` (RLS-scoped to the caller's
  // workspace) is the only DNC source reachable server-side; candidate-level
  // compliance flags live solely in the client store and cannot be enforced here.
  // claim_and_record re-checks this atomically; this is explicit defence-in-depth.
  const emailLc = candidateEmail.toLowerCase();
  const domainLc = emailLc.split("@")[1] ?? "";
  const { data: suppRows, error: suppErr } = await supabase
    .from("suppression_list")
    .select("type, value, expires_at")
    .eq("workspace_id", approvalWid)
    .in("type", ["email", "domain"])
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (suppErr) {
    safeLog("suppression_list check error", { message: suppErr.message, code: suppErr.code });
    return NextResponse.json({ status: "error", detail: "Suppression check failed." }, { status: 500 });
  }
  const suppressed = (suppRows ?? []).some((s) => {
    const v = String(s.value).toLowerCase();
    return (s.type === "email" && v === emailLc) || (s.type === "domain" && domainLc !== "" && v === domainLc);
  });
  if (suppressed) {
    return NextResponse.json({ status: "skipped", detail: "Recipient is on the suppression / do-not-contact list." });
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
    safeLog("claim_and_record error", { message: claimErr.message, code: claimErr.code });
    return NextResponse.json({ status: "error", detail: "Guardrail check failed." }, { status: 500 });
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

  // 5. Domain verification — live sends require a domain with sender policy records.
  if (!seat.domain_verified) {
    const verified = await domainVerified(seat.operator_email.split("@")[1] ?? "");
    if (verified) {
      await supabase.from("agent_seats").update({ domain_verified: true }).eq("id", seatId);
      seat.domain_verified = true;
    }
  }
  if (!seat.domain_verified) {
    return NextResponse.json({ status: "dry-run", detail: "Domain not verified (SPF/DKIM/DMARC) — dry-run." });
  }

  // 6. Send — From is the SEAT's verified mailbox, never the request body.
  try {
    let outcome: { status: "sent" | "dry-run" | "error"; provider: string; detail: string; id?: string };

    if (seat.provider === "Gmail API" || seat.provider === "Microsoft Graph") {
      const svc = getServiceSupabase();
      // Defence-in-depth workspace check: resolve the caller's workspace_id via
      // the RPC (same pattern as hermes/chat resolveVaultSecret), then verify
      // the service-role result matches — RLS alone is not sufficient when the
      // service role bypasses row-level policies.
      const { data: wid } = await supabase.rpc("current_workspace_id");
      const { data: conn } = await svc
        ?.from("email_connections")
        .select("id, access_token, refresh_token, expires_at, scope, account_email, workspace_id")
        .eq("seat_id", seatId)
        .single() ?? { data: null };
      if (!conn || conn.workspace_id !== wid) {
        return NextResponse.json({ status: "dry-run", detail: `${seat.provider} mailbox not connected — dry-run.` });
      }
      // Tokens are stored encrypted at rest; decrypt for use. Keep the decrypted
      // original to detect a refresh below.
      const origAccessToken = decryptSecret(conn.access_token);
      const connection: EmailConnection = {
        id: conn.id,
        seatId,
        provider: seat.provider,
        accountEmail: conn.account_email,
        accessToken: origAccessToken,
        refreshToken: conn.refresh_token ? decryptSecret(conn.refresh_token) : conn.refresh_token,
        expiresAt: conn.expires_at,
        scope: conn.scope,
        connectedAt: "",
        updatedAt: "",
      };

      if (seat.provider === "Gmail API") {
        outcome = await sendViaGmailApi({ from: seat.operator_email, to: candidateEmail, subject, body }, connection);
      } else {
        outcome = await sendViaMicrosoftGraph({ from: seat.operator_email, to: candidateEmail, subject, body }, connection);
      }

      // Persist refreshed token if it changed.
      if (svc && (origAccessToken !== connection.accessToken || conn.expires_at !== connection.expiresAt)) {
        await svc
          .from("email_connections")
          .update({ access_token: encryptSecret(connection.accessToken), expires_at: connection.expiresAt, updated_at: new Date().toISOString() })
          .eq("id", connection.id);
      }
    } else {
      outcome = await sendViaProvider({
        provider: seat.provider as SendRequest["provider"],
        from: seat.operator_email,
        to: candidateEmail,
        subject,
        body,
      });
    }

    if (outcome.status === "sent") await reconcile("sent", null);
    else await reconcile("skipped", outcome.detail); // dry-run / provider error → free the slot
    return NextResponse.json(outcome);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Send failed.";
    await reconcile("skipped", detail);
    return NextResponse.json({ status: "error", detail }, { status: 500 });
  }
}
