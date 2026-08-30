import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { domainVerified } from "@/lib/domain-verification";
import { performEmailSend } from "@/lib/email-send";
import { createEmailUnsubscribeLink } from "@/lib/email-unsubscribe";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed, demoLoginEnabled } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import type { Role } from "@/lib/types";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";
import { gateOutbound } from "@/lib/gate";
import { outreachQualityGate } from "@/lib/outreach-quality-pipeline";
import { validateOutreachQualityLive } from "@/lib/outreach-quality-pipeline-live";
import { getOutboundChannelPolicy } from "@/lib/linkedin-policy";
import { approvalHash, approvalScopeHash, sanitizeOutreachSubject } from "@/lib/outreach-content";
import { normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";
import { dispatchDue } from "@/lib/dispatch-outbound";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { detectInjection, disclosureInternalFromCampaignLike, validateCandidateBoundText } from "@/lib/agent-disclosure-policy";
import { isMailboxSeatProvider } from "@/lib/outreach-send-mode";
import {
  heyReachDeliveryReadyFromEnv,
  heyReachDeliveryReadyForWorkspace,
} from "@/lib/heyreach-delivery";
import { normalizeLinkedInProfileUrl } from "@/lib/linkedin-connections";

const OutreachSendSchema = z.object({
  seatId: z.string().uuid().optional(),
  messageId: z.string().min(1).max(120),
  candidateId: z.string().min(1).max(120),
  candidateEmail: z.string().email().max(255).optional(),
  to: z.string().email().max(255).optional(),
  profileUrl: z.string().max(500).optional(),
  campaignId: z.string().min(1).max(120),
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(50_000),
  channel: z.enum(["Email", "LinkedIn", "WhatsApp", "SMS"]).default("Email"),
  phone: z.string().max(40).optional(),
  confirmLive: z.boolean().default(false),
});

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Outreach send endpoint — safe by construction.
 *
 * A real send happens ONLY when ALL hold:
 *   1. Supabase is configured (the server-side guardrail backend exists).
 *   2. The caller has an authenticated session.
 *   3. The named seat belongs to the caller's workspace, is `live`, and has a
 *      verified domain. The From address is taken from the SEAT, never the body.
 *   4. Email clears `claim_email_outbound`; WhatsApp is written to the durable
 *      outbox and clears `claim_whatsapp_outbound` before the dispatcher sends.
 *      SMS remains disabled before any database or provider work.
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

  // LinkedIn is assisted-manual unless HeyReach / vendor API is configured
  // (Fly env and/or Settings → LinkedIn stack vault + campaign id).
  const linkedInVendorConfigured = Boolean(
    process.env.LINKEDIN_VENDOR_API_URL && process.env.LINKEDIN_VENDOR_API_KEY,
  );
  let heyReachConfigured = heyReachDeliveryReadyFromEnv();
  const earlyChannelPolicy = getOutboundChannelPolicy(channel, {
    heyReachConfigured,
    linkedInVendorConfigured,
  });
  if (!earlyChannelPolicy.ok) {
    // Defer LinkedIn fail until after workspace auth when confirmLive — Settings
    // may hold the vault key + campaign id even without Fly secrets.
    if (channel !== "LinkedIn" || !payload.confirmLive) {
      return NextResponse.json(
        { status: "manual-required", detail: earlyChannelPolicy.reason },
        { status: 409 },
      );
    }
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

  if (channel === "LinkedIn" && !earlyChannelPolicy.ok) {
    heyReachConfigured = await heyReachDeliveryReadyForWorkspace(String(approvalWid));
    const channelPolicy = getOutboundChannelPolicy("LinkedIn", {
      heyReachConfigured,
      linkedInVendorConfigured,
    });
    if (!channelPolicy.ok) {
      return NextResponse.json(
        { status: "manual-required", detail: channelPolicy.reason },
        { status: 409 },
      );
    }
  }

  const { data: workspaceState } = await supabase
    .from("workspace_state")
    .select("state")
    .eq("workspace_id", approvalWid)
    .maybeSingle();
  const campaigns = Array.isArray(record(workspaceState?.state)?.campaigns)
    ? record(workspaceState?.state)?.campaigns as unknown[]
    : [];
  const campaign = campaigns.find((item) => record(item)?.id === campaignId);
  const disclosure = validateCandidateBoundText(body, disclosureInternalFromCampaignLike(campaign));
  const injection = detectInjection(body);
  if (!disclosure.safe || injection.flagged) {
    return NextResponse.json(
      { status: "error", detail: disclosure.reason ?? "injection-suspected" },
      { status: 422 },
    );
  }
  const approvedContentHash = approvalHash(subject, body);
  const linkedInRecipient =
    channel === "LinkedIn"
      ? (normalizeLinkedInProfileUrl(payload.profileUrl ?? "") ??
          (payload.profileUrl ?? "").trim()).toLowerCase()
      : "";
  const approvedScopeHash = approvalScopeHash({
    candidateId,
    channel,
    recipient:
      channel === "WhatsApp"
        ? payload.phone ?? ""
        : channel === "LinkedIn"
          ? linkedInRecipient
          : candidateEmail,
  });
  if (!approvedScopeHash) {
    return NextResponse.json({ status: "error", detail: "Invalid approved recipient." }, { status: 400 });
  }
  const { data: approval } = await supabase
    .from("outreach_approvals")
    .select("body_hash, approval_scope_hash, approval_source, approved_by, template_id, revoked_at")
    .eq("workspace_id", approvalWid)
    .eq("message_id", payload.messageId)
    .is("revoked_at", null)
    .maybeSingle();
  if (
    !approval ||
    approval.body_hash !== approvedContentHash ||
    approval.approval_scope_hash !== approvedScopeHash
  ) {
    return NextResponse.json(
      { status: "error", detail: "Message lacks a current approval (or changed since approval)." },
      { status: 403 },
    );
  }
  const source = String(approval.approval_source ?? "");
  let approvalAuthorized = source === "human";
  if (!approvalAuthorized && (source === "autopilot_critics" || source === "template_bound")) {
    const { data: authorized } = await supabase.rpc("outbound_approval_authorizes_send", {
      p_workspace_id: approvalWid,
      p_approval_source: source,
      p_approved_by: approval.approved_by,
      p_template_id: approval.template_id,
      p_revoked_at: approval.revoked_at,
    });
    // RPC is service_role-only on older migrations — fall back to profile check.
    if (authorized === true) {
      approvalAuthorized = true;
    } else if (approval.approved_by) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("autopilot_enabled")
        .eq("id", approval.approved_by)
        .eq("workspace_id", approvalWid)
        .maybeSingle();
      approvalAuthorized = profile?.autopilot_enabled === true;
    }
  }
  if (!approvalAuthorized) {
    return NextResponse.json(
      { status: "error", detail: "Message lacks a current human or autopilot approval (or changed since approval)." },
      { status: 403 },
    );
  }

  // Human-likeness gate (all channels): text that reads as machine output —
  // status narration, AI self-disclosure, leaked tool/JSON markup, unfilled
  // placeholders — never reaches a candidate, approved or not. Block-only:
  // the approved text is never mutated here, so the approval hash stays valid.
  const qualityGate = outreachQualityGate({ subject, body, channel });
  if (qualityGate.blockers.length > 0) {
    return NextResponse.json(
      { status: "error", detail: qualityGate.blockers[0] },
      { status: 422 },
    );
  }
  // Live critics: production / non-demo tenants require all three LLM peers
  // (same fail-closed posture as generate-outreach-draft). Demo may fall back
  // to the deterministic gate already applied above.
  // After a valid human approval, needs_review is resolved — only block blocked.
  const liveVerdict = await validateOutreachQualityLive({
    subject,
    body,
    channel,
    workspaceId:
      demoLoginEnabled || publicDemoSideEffectsDisabled()
        ? undefined
        : typeof approvalWid === "string"
          ? approvalWid
          : undefined,
  });
  if (!liveVerdict.llmCriticsUsed) {
    if (!demoLoginEnabled) {
      return NextResponse.json(
        {
          status: "error",
          detail: "Live multi-agent LLM quality critics required for outreach send.",
          code: "critics_required",
        },
        { status: 503 },
      );
    }
    if (liveVerdict.status === "blocked") {
      const reason =
        liveVerdict.stages.find((s) => !s.pass)?.reasons[0]
        ?? "Outreach blocked by quality critics.";
      return NextResponse.json({ status: "error", detail: reason }, { status: 422 });
    }
  } else if (liveVerdict.status === "blocked") {
    const reason =
      liveVerdict.stages.find((s) => !s.pass)?.reasons[0]
      ?? "Outreach blocked by live quality critics.";
    return NextResponse.json({ status: "error", detail: reason }, { status: 422 });
  }
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

    if (publicDemoSideEffectsDisabled()) {
      return NextResponse.json({ status: "dry-run", detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
    }

    const { data: queuedData, error: queueErr } = await supabase.rpc("enqueue_whatsapp_outbound", {
      p_message_id: payload.messageId,
      p_candidate_id: candidateId,
      p_campaign_id: campaignId,
      p_seat_id: seatId,
      p_recipient: recipientE164,
      p_type: "candidate_reply",
      p_subject: subject,
      p_body: body,
      p_template_id: null,
      p_template_parameters: [],
    });
    const queued = queuedData as { ok?: boolean; status?: string; id?: string; reason?: string } | null;
    if (queueErr || queued?.ok !== true || queued.status !== "queued" || !queued.id) {
      if (queued?.reason === "duplicate") {
        return NextResponse.json({ status: "skipped", detail: "This WhatsApp message is already queued or was sent." });
      }
      safeLog("whatsapp outbox queue error", {
        message: queueErr?.message ?? queued?.reason ?? "no result",
        code: queueErr?.code,
      });
      return NextResponse.json({ status: "error", detail: "Could not queue the WhatsApp message." }, { status: 500 });
    }
    const dispatcher = getServiceSupabase();
    if (dispatcher) {
      try {
        await dispatchDue(dispatcher, 1, queued.id);
      } catch (err) {
        safeLog("whatsapp immediate dispatch error", { message: err instanceof Error ? err.message : "unknown" });
      }

      // A worker can intentionally leave an accepted provider request in
      // `dispatching` when its durable acceptance record failed.  That state is
      // not queued and must never invite a client retry, which could double-send.
      const { data: dispatched, error: dispatchedErr } = await dispatcher
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
      if (dispatched?.status === "dispatching") {
        return NextResponse.json(
          {
            status: "reconciliation-required",
            delivery: "whatsapp-reconciliation-required",
            messageId: queued.id,
            detail: "WhatsApp provider acceptance is not yet reconciled. Do not retry this message.",
          },
          { status: 502 },
        );
      }
      if (dispatchedErr || !dispatched || dispatched.status !== "queued") {
        safeLog("whatsapp immediate dispatch state unavailable", { message: dispatchedErr?.message ?? "no outbox row" });
        return NextResponse.json(
          {
            status: "reconciliation-required",
            delivery: "whatsapp-reconciliation-required",
            messageId: queued.id,
            detail: "WhatsApp delivery state could not be confirmed. Do not retry this message.",
          },
          { status: 502 },
        );
      }
    }
    return NextResponse.json({
      status: "queued",
      delivery: "whatsapp-delivery-queued",
      messageId: queued.id,
      detail: "Queued for policy-checked WhatsApp delivery. No message was sent by this request.",
    }, { status: 202 });
  }

  // LinkedIn via HeyReach / vendor — durable outbox, never email fallthrough.
  if (channel === "LinkedIn") {
    if (!seatId) {
      return NextResponse.json({ status: "error", detail: "Missing seatId." }, { status: 400 });
    }
    const profile =
      normalizeLinkedInProfileUrl(payload.profileUrl ?? "") ??
      (payload.profileUrl ?? "").trim();
    if (!profile || !/linkedin\.com\//i.test(profile)) {
      return NextResponse.json(
        { status: "skipped", detail: "No LinkedIn profile URL on file for this candidate." },
      );
    }
    const { data: liSeat } = await supabase
      .from("agent_seats")
      .select("id, provider, status, mode")
      .eq("id", seatId)
      .maybeSingle();
    if (!liSeat) {
      return NextResponse.json({ status: "error", detail: "Seat not found in your workspace." }, { status: 403 });
    }
    if (liSeat.status !== "active") {
      return NextResponse.json({ status: "skipped", detail: "Seat is not active." });
    }
    if (liSeat.mode !== "live") {
      return NextResponse.json({ status: "dry-run", detail: "Seat not live, nothing sent." });
    }
    const provider = String(liSeat.provider ?? "");
    if (
      provider !== "HeyReach" &&
      provider !== "LinkedIn Vendor API" &&
      provider !== "LinkedIn Assisted Manual"
    ) {
      return NextResponse.json({
        status: "skipped",
        detail: "Selected seat cannot send LinkedIn. Use a HeyReach or LinkedIn Vendor seat.",
      });
    }
    if (provider === "LinkedIn Assisted Manual") {
      return NextResponse.json(
        {
          status: "manual-required",
          detail: "Assisted-manual LinkedIn seat — copy/paste the draft, then Confirm Manual Send.",
        },
        { status: 409 },
      );
    }
    if (publicDemoSideEffectsDisabled()) {
      return NextResponse.json({ status: "dry-run", detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
    }
    const dispatcher = getServiceSupabase();
    if (!dispatcher) {
      return NextResponse.json({ status: "error", detail: "Service client unavailable." }, { status: 503 });
    }
    const { data: queuedData, error: queueErr } = await dispatcher.rpc("enqueue_linkedin_outbound_service", {
      p_workspace_id: approvalWid,
      p_message_id: payload.messageId,
      p_candidate_id: candidateId,
      p_campaign_id: campaignId,
      p_seat_id: seatId,
      p_profile_url: profile.toLowerCase(),
      p_subject: subject,
      p_body: body,
    });
    const queued = queuedData as { ok?: boolean; status?: string; id?: string; reason?: string } | null;
    if (queueErr || (queued?.ok !== true && queued?.reason !== "duplicate") || !queued?.id) {
      safeLog("linkedin outbox queue error", {
        message: queueErr?.message ?? queued?.reason ?? "no result",
      });
      return NextResponse.json(
        { status: "error", detail: "Could not queue the LinkedIn message. Apply migration 0076." },
        { status: 500 },
      );
    }
    try {
      await dispatchDue(dispatcher, 1, queued.id);
    } catch (err) {
      safeLog("linkedin immediate dispatch error", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
    return NextResponse.json(
      {
        status: "queued",
        delivery: "linkedin-delivery-queued",
        messageId: queued.id,
        detail: "Queued for policy-checked LinkedIn delivery via HeyReach/vendor.",
      },
      { status: 202 },
    );
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
  // Email path only — LinkedIn/WhatsApp/SMS seats must never claim Graph mail send.
  if (!isMailboxSeatProvider(String(seat.provider ?? ""))) {
    return NextResponse.json({
      status: "skipped",
      detail: "Selected seat cannot send Email. Use a live Outlook, Gmail, SendGrid, or Resend mailbox.",
    });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ status: "dry-run", detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }

  // Domain verification happens before the irreversible claim. A dry-run
  // decision must never leave a claimed ledger row that blocks later outreach.
  // Microsoft Graph OAuth seats send as the connected mailbox (me/sendMail) —
  // DNS SPF on the operator label is not required once mode=live after Connect Outlook.
  if (!seat.domain_verified) {
    const isGraph = String(seat.provider ?? "") === "Microsoft Graph";
    if (isGraph && seat.mode === "live") {
      const { error: healErr } = await supabase
        .from("agent_seats")
        .update({ domain_verified: true })
        .eq("id", seatId);
      if (healErr) {
        safeLog("outreach send Graph domain_verified heal failed", {
          message: healErr.message,
          code: healErr.code,
        });
      } else {
        seat.domain_verified = true;
      }
    } else {
      const verified = await domainVerified(seat.operator_email.split("@")[1] ?? "");
      if (verified) {
        const { error: healErr } = await supabase
          .from("agent_seats")
          .update({ domain_verified: true })
          .eq("id", seatId);
        if (healErr) {
          safeLog("outreach send domain_verified heal failed", {
            message: healErr.message,
            code: healErr.code,
          });
        } else {
          seat.domain_verified = true;
        }
      }
    }
  }
  if (!seat.domain_verified) {
    return NextResponse.json({
      status: "dry-run",
      detail: "Sender domain not verified (need SPF, DMARC, or DKIM), dry-run.",
    });
  }

  // 4. Synchronous, policy-checked send — the interactive "Send" button delivers
  // NOW and returns "sent". It uses claim_email_outbound (0011, already deployed)
  // so it works against the live schema, and performEmailSend (the shared send
  // primitive) so the actual provider call is gate-identical to the worker path.
  // (The durable enqueue/dispatch path — 0039 — is the autonomous WORKER's route
  // for browser-closed sending; it is NOT this request, and must not gate the
  // button on migrations that may not be applied yet.)
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
  if ((suppRows ?? []).some((s) => {
    const v = String(s.value).toLowerCase();
    return (s.type === "email" && v === emailLc) || (s.type === "domain" && domainLc !== "" && v === domainLc);
  })) {
    return NextResponse.json({ status: "skipped", detail: "Recipient is on the suppression / do-not-contact list." });
  }

  // Live email requires a real one-click unsubscribe link — no provider-only fallback.
  const unsubscribe = createEmailUnsubscribeLink();
  if (!unsubscribe) {
    return NextResponse.json(
      { status: "error", detail: "Email delivery is unavailable until the unsubscribe endpoint is configured." },
      { status: 503 },
    );
  }

  // Atomic approval + guardrail claim: locks the active human approval and creates
  // the ledger claim in one transaction, so a revoke cannot land between the
  // client-visible approval validation and the provider dispatch.
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
    safeLog("claim_email_outbound error", { message: claimErr.message, code: claimErr.code });
    return NextResponse.json({ status: "error", detail: "Guardrail check failed." }, { status: 500 });
  }
  const claimObj = claim as { allowed?: boolean; reason?: string; ledger_id?: string } | null;
  if (claimObj?.allowed !== true) {
    return NextResponse.json({ status: "skipped", detail: `Guardrail blocked: ${claimObj?.reason ?? "blocked by guardrails"}` });
  }
  const ledgerId = claimObj.ledger_id;
  const reconcile = async (status: "sent" | "skipped" | "ambiguous", reason: string | null) => {
    if (ledgerId) await supabase.from("outreach_ledger").update({ status, reason }).eq("id", ledgerId);
  };

  // Immutable per-attempt identity, stamped on the ledger before any provider call
  // and travelling as the X-Aria-Send-Attempt header + MIME Message-ID.
  const sendAttemptId = randomUUID();
  const serviceSupabase = getServiceSupabase();
  if (!serviceSupabase || !ledgerId) {
    await reconcile("skipped", "Send service unavailable.");
    return NextResponse.json({ status: "error", detail: "Email delivery is unavailable (service client)." }, { status: 503 });
  }
  // The RFC 5322 Message-ID travels in the MIME header AND is stamped on the
  // ledger so a later bounce/complaint delivery webhook can correlate this
  // synchronous send (which never creates a messages_outbound row) and suppress
  // the address. Stamped before the provider call so even an ambiguous outcome
  // stays correlatable.
  const rfcMessageId = `<${sendAttemptId}@${seat.operator_email.split("@")[1] ?? "mail"}>`;
  const { data: tokenBound, error: tokenBindErr } = await serviceSupabase
    .from("outreach_ledger")
    .update({ email_unsubscribe_token_hash: unsubscribe.tokenHash, send_attempt_id: sendAttemptId, rfc_message_id: rfcMessageId })
    .eq("id", ledgerId)
    .eq("workspace_id", approvalWid)
    .is("email_unsubscribe_token_hash", null)
    .select("id")
    .maybeSingle();
  if (tokenBindErr || !tokenBound) {
    safeLog("email unsubscribe token bind error", { message: tokenBindErr?.message ?? "no ledger row" });
    await reconcile("skipped", "Unsubscribe token storage failed.");
    return NextResponse.json({ status: "error", detail: "Email could not prepare the unsubscribe link." }, { status: 503 });
  }

  const reconciliationRequired = () =>
    NextResponse.json(
      {
        status: "reconciliation-required",
        delivery: "email-reconciliation-required",
        sendAttemptId,
        detail: "Email delivery state could not be confirmed. Do not retry this message.",
      },
      { status: 502 },
    );
  let transportStarted = false;
  try {
    // 5. Send — From is the SEAT's verified mailbox, never the request body.
    transportStarted = true;
    const outcome = await performEmailSend(serviceSupabase, {
      workspaceId: approvalWid,
      seatId,
      provider: seat.provider,
      operatorEmail: seat.operator_email,
      to: candidateEmail,
      subject,
      body,
      unsubscribeUrl: unsubscribe.url,
      attemptId: sendAttemptId,
      rfcMessageId,
    });

    if (outcome.status === "sent" && outcome.deliveryState === "accepted") {
      await reconcile("sent", null);
      return NextResponse.json({ status: "sent", detail: outcome.detail });
    }
    if (outcome.deliveryState === "not-sent") {
      // Proven pre-transport failure, or a dry-run (provider unconfigured): the
      // provider definitively never accepted, so the de-dupe slot is retryable.
      await reconcile("skipped", outcome.detail);
      return NextResponse.json({ status: outcome.status === "dry-run" ? "dry-run" : "error", detail: outcome.detail });
    }
    // deliveryState 'unknown' — a timeout/5xx may have followed acceptance. Hold the
    // slot as 'ambiguous' for human reconciliation; never retry (double-send risk).
    await reconcile("ambiguous", outcome.detail);
    return reconciliationRequired();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Email send reconciliation failed.";
    if (transportStarted) {
      try {
        await reconcile("ambiguous", detail);
      } catch (reconcileErr) {
        safeLog("email ambiguous reconciliation failed", {
          message: reconcileErr instanceof Error ? reconcileErr.message : "unknown",
        });
      }
      return reconciliationRequired();
    }
    await reconcile("skipped", detail);
    return NextResponse.json({ status: "error", detail });
  }
}
