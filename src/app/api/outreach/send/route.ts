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
import { dedupeHash, gateOutbound } from "@/lib/gate";
import { encryptSecret, decryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import { getOutboundChannelPolicy } from "@/lib/linkedin-policy";
import { approvalHash, approvalScopeHash, sanitizeOutreachSubject } from "@/lib/outreach-content";
import { normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";
import { dispatchDue } from "@/lib/dispatch-outbound";
import { createEmailUnsubscribeLink } from "@/lib/email-unsubscribe";

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
 *   4. Email/SMS clears `claim_and_record`; WhatsApp is written to the durable
 *      outbox and clears `claim_whatsapp_outbound` before the dispatcher sends.
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
  const channel = payload.channel ?? "Email";

  // LinkedIn is always an assisted-manual channel unless a separately approved
  // official integration is implemented. Reject before any provider, approval,
  // claim, or email fallback can make this look like a deliverable send.
  const channelPolicy = getOutboundChannelPolicy(channel);
  if (!channelPolicy.ok) {
    return NextResponse.json(
      { status: "manual-required", detail: channelPolicy.reason },
      { status: 409 },
    );
  }
  if (channel === "SMS") {
    return NextResponse.json(
      {
        status: "manual-required",
        detail: "Live SMS delivery is disabled until recorded consent, opt-out, suppression, and durable dispatch controls are implemented.",
      },
      { status: 409 },
    );
  }

  const seatId = payload.seatId ?? "";
  const candidateId = payload.candidateId;
  const candidateEmail = payload.candidateEmail ?? payload.to ?? "";
  const campaignId = payload.campaignId;
  const body = payload.body;
  // Strip CR/LF + control chars from the subject to prevent header/MIME injection.
  const subject = sanitizeOutreachSubject(payload.subject);
  const { confirmLive } = payload;

  // DEMO mode: no server-side guardrails → never send.
  if (!supabaseEnabled || !confirmLive) {
    return NextResponse.json({
      status: "dry-run",
      detail: !supabaseEnabled
        ? "Demo mode: no enforcement backend. Nothing sent."
        : "Dry-run: confirmLive not set. Nothing sent.",
    });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ status: "dry-run", detail: "No Supabase client, dry-run." });
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
  if (!approvalWid) {
    return NextResponse.json({ status: "error", detail: "Workspace not found." }, { status: 400 });
  }
  const approvedContentHash = approvalHash(subject, body);
  const approvedScopeHash = approvalScopeHash({
    candidateId,
    channel,
    recipient: channel === "WhatsApp" ? payload.phone ?? "" : candidateEmail,
  });
  if (!approvedScopeHash) {
    return NextResponse.json({ status: "error", detail: "Invalid approved recipient." }, { status: 400 });
  }
  const { data: approval } = await supabase
    .from("outreach_approvals")
    .select("body_hash, approval_scope_hash, approval_source")
    .eq("workspace_id", approvalWid)
    .eq("message_id", payload.messageId)
    .is("revoked_at", null)
    .maybeSingle();
  if (
    !approval ||
    approval.body_hash !== approvedContentHash ||
    approval.approval_scope_hash !== approvedScopeHash ||
    approval.approval_source !== "human"
  ) {
    return NextResponse.json(
      { status: "error", detail: "Message lacks a current human approval (or changed since approval)." },
      { status: 403 },
    );
  }

  // Human-likeness gate (all channels): text that reads as machine output —
  // status narration, AI self-disclosure, leaked tool/JSON markup, unfilled
  // placeholders — never reaches a candidate, approved or not. Block-only:
  // the approved text is never mutated here, so the approval hash stays valid.
  const gate = gateOutbound(body);
  if (!gate.pass) {
    return NextResponse.json(
      { status: "error", detail: `Human-likeness gate blocked: ${gate.reasons.join(", ")}.` },
      { status: 422 },
    );
  }

  if (!seatId) {
    return NextResponse.json({ status: "error", detail: "Missing seatId." }, { status: 400 });
  }

  // WhatsApp never calls Meta from this request handler. The approved message
  // becomes a durable outbox row, then the service-only dispatcher re-checks
  // consent, DNC, window/template, and the human approval inside one DB claim.
  // This prevents a raw client payload from bypassing the delivery policy.
  if (channel === "WhatsApp") {
    const phone = (payload.phone ?? "").trim();
    if (!phone) {
      return NextResponse.json({ status: "skipped", detail: "No phone number on file for this candidate." });
    }
    const recipientE164 = normalizeWhatsAppAddress(phone);
    if (!recipientE164) {
      return NextResponse.json({ status: "error", detail: "A valid E.164 WhatsApp number is required." }, { status: 400 });
    }
    const { data: phoneSeat } = await supabase
      .from("agent_seats")
      .select("id, provider, status, mode")
      .eq("id", seatId)
      .maybeSingle();
    if (!phoneSeat) {
      return NextResponse.json({ status: "error", detail: "Seat not found in your workspace." }, { status: 403 });
    }
    if (phoneSeat.status !== "active") {
      return NextResponse.json({ status: "skipped", detail: "Seat is not active." });
    }
    if (phoneSeat.mode !== "live") {
      return NextResponse.json({ status: "dry-run", detail: "Seat not live, nothing sent." });
    }
    if (phoneSeat.provider !== "WhatsApp Cloud") {
      return NextResponse.json({ status: "skipped", detail: "Seat is not a WhatsApp Cloud sender." });
    }

    const { data: queued, error: queueErr } = await supabase
      .from("messages_outbound")
      .insert({
        workspace_id: approvalWid,
        candidate_id: candidateId,
        seat_id: seatId,
        channel: "WhatsApp",
        to_address: recipientE164,
        recipient_e164: recipientE164,
        approval_message_id: payload.messageId,
        type: "candidate_reply",
        subject,
        body,
        status: "queued",
        gate_result: { pass: true, reasons: [] },
        content_hash: createHash("sha256").update(body, "utf8").digest("hex"),
        dedupe_hash: dedupeHash(candidateId, "WhatsApp", body),
        scheduled_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (queueErr || !queued) {
      if (queueErr?.code === "23505") {
        return NextResponse.json({ status: "skipped", detail: "This WhatsApp message is already queued or was sent." });
      }
      safeLog("whatsapp outbox queue error", { message: queueErr?.message ?? "no row", code: queueErr?.code });
      return NextResponse.json({ status: "error", detail: "Could not queue the WhatsApp message." }, { status: 500 });
    }
    const dispatcher = getServiceSupabase();
    if (dispatcher) {
      try {
        await dispatchDue(dispatcher, 1, queued.id);
        const { data: dispatched } = await dispatcher
          .from("messages_outbound")
          .select("status")
          .eq("id", queued.id)
          .maybeSingle();
        if (dispatched?.status === "sent") {
          return NextResponse.json({ status: "sent", detail: "Sent through the policy-checked WhatsApp dispatcher." });
        }
        if (dispatched?.status === "blocked") {
          return NextResponse.json({ status: "skipped", detail: "WhatsApp policy blocked this message before delivery." });
        }
        if (dispatched?.status === "failed") {
          return NextResponse.json({ status: "error", detail: "WhatsApp delivery failed after the policy checks." }, { status: 502 });
        }
      } catch (err) {
        safeLog("whatsapp immediate dispatch error", { message: err instanceof Error ? err.message : "unknown" });
      }
    }
    return NextResponse.json({
      status: "queued",
      delivery: "whatsapp-delivery-queued",
      messageId: queued.id,
      detail: "Queued for policy-checked WhatsApp delivery. No message was sent by this request.",
    }, { status: 202 });
  }

  // 3. Seat must belong to the caller's workspace (RLS) and be live. Domain
  // verification is deliberately NOT gated here — the real DNS check-and-persist
  // happens in step 5 below, which is the only place `domain_verified` is ever
  // set true. Requiring it up front would make a seat permanently unverifiable.
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
  if (seat.mode !== "live") {
    return NextResponse.json({ status: "dry-run", detail: "Seat not live, nothing sent." });
  }

  // Domain verification happens before the irreversible claim. A dry-run
  // decision must never leave a claimed ledger row that blocks later outreach.
  if (!seat.domain_verified) {
    const verified = await domainVerified(seat.operator_email.split("@")[1] ?? "");
    if (verified) {
      await supabase.from("agent_seats").update({ domain_verified: true }).eq("id", seatId);
      seat.domain_verified = true;
    }
  }
  if (!seat.domain_verified) {
    return NextResponse.json({ status: "dry-run", detail: "Domain not verified (SPF/DKIM/DMARC), dry-run." });
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

  // Live email is disabled unless every recipient receives a real public
  // one-click unsubscribe link. There is no provider-only fallback.
  const unsubscribe = createEmailUnsubscribeLink();
  if (!unsubscribe) {
    return NextResponse.json(
      { status: "error", detail: "Email delivery is unavailable until the unsubscribe endpoint is configured." },
      { status: 503 },
    );
  }

  // 4. Atomic approval + guardrail claim. The function locks the active human
  // approval and creates the ledger claim in one transaction, so a revoke cannot
  // land between client-visible approval validation and provider dispatch.
  const { data: claim, error: claimErr } = await supabase.rpc("claim_email_outbound", {
    p_message_id: payload.messageId,
    p_body_hash: approvedContentHash,
    p_approval_scope_hash: approvedScopeHash,
    p_candidate_id: candidateId,
    p_candidate_email: candidateEmail,
    p_campaign_id: campaignId,
    p_seat_id: seatId,
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

  // Token hashes are service-only data. Bind this exact recipient token to the
  // just-claimed ledger before touching any provider; failure releases the claim
  // and sends nothing.
  const serviceSupabase = getServiceSupabase();
  if (!serviceSupabase || !ledgerId) {
    await reconcile("skipped", "Unsubscribe token storage is unavailable.");
    return NextResponse.json(
      { status: "error", detail: "Email delivery is unavailable until unsubscribe storage is configured." },
      { status: 503 },
    );
  }
  const { data: tokenBound, error: tokenBindErr } = await serviceSupabase
    .from("outreach_ledger")
    .update({ email_unsubscribe_token_hash: unsubscribe.tokenHash })
    .eq("id", ledgerId)
    .eq("workspace_id", approvalWid)
    .is("email_unsubscribe_token_hash", null)
    .select("id")
    .maybeSingle();
  if (tokenBindErr || !tokenBound) {
    safeLog("email unsubscribe token bind error", { message: tokenBindErr?.message ?? "no ledger row" });
    await reconcile("skipped", "Unsubscribe token storage failed.");
    return NextResponse.json(
      { status: "error", detail: "Email delivery could not prepare the unsubscribe link." },
      { status: 503 },
    );
  }

  // 5. Send — From is the SEAT's verified mailbox, never the request body.
  try {
    let outcome: { status: "sent" | "dry-run" | "error"; provider: string; detail: string; id?: string };

    if (seat.provider === "Gmail API" || seat.provider === "Microsoft Graph") {
      const svc = serviceSupabase;
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
        await reconcile("skipped", `${seat.provider} mailbox not connected.`);
        return NextResponse.json({ status: "dry-run", detail: `${seat.provider} mailbox not connected, dry-run.` });
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
        outcome = await sendViaGmailApi({ from: seat.operator_email, to: candidateEmail, subject, body, unsubscribeUrl: unsubscribe.url }, connection);
      } else {
        outcome = await sendViaMicrosoftGraph({ from: seat.operator_email, to: candidateEmail, subject, body, unsubscribeUrl: unsubscribe.url }, connection);
      }

      // Persist refreshed token if it changed. Fail closed: never write a refreshed
      // token in cleartext when production requires encryption at rest but no key is
      // configured — skip the persist (the send itself already happened above)
      // rather than silently degrade the stored credential to plaintext.
      if (
        svc &&
        (origAccessToken !== connection.accessToken || conn.expires_at !== connection.expiresAt) &&
        !encryptionRequiredButMissing()
      ) {
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
        unsubscribeUrl: unsubscribe.url,
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
