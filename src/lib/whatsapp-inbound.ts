import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { safeLog } from "@/lib/log-redact";
import { dedupeHash } from "@/lib/gate";
import { isWhatsAppOptOut } from "@/lib/whatsapp-policy";
import { buildReplyPrompt, decideAutopilot, type SpecGuardrails } from "@/lib/autopilot";
import {
  candidateDisclosureContextForCampaignLike,
  detectInjection,
} from "@/lib/agent-disclosure-policy";
import { approvalHash, approvalScopeHash } from "@/lib/outreach-content";
import { dispatchDue } from "@/lib/dispatch-outbound";
import {
  loadSourcingLoopControls,
  sequencesArmedFromControls,
} from "@/lib/sourcing-loop-controls";
import {
  CLOUD_ENDPOINT,
  DEFAULT_MODEL,
  PROVIDER_ENV,
  buildCloudRequest,
  parseCloudResponse,
  type AiProviderSlug,
} from "@/lib/ai/provider";

type InboundOutcome = "processed" | "triage" | "retry" | "skipped";

export interface WhatsAppInboundProcessResult {
  outcome: InboundOutcome;
  reason: string;
}

interface InboundClaim {
  ok?: boolean;
  reason?: string;
  claim_id?: string;
  workspace_id?: string;
  sender_id?: string;
  from_address?: string;
  body?: string;
  provider_id?: string | null;
  received_at?: string;
}

interface StoredInboundRow {
  id: string;
  whatsapp_sender_id: string | null;
}

interface ResolvedConversation {
  ok?: boolean;
  reason?: string;
  conversation_id?: string | null;
  candidate_id?: string | null;
  spec_id?: string | null;
  owner_id?: string | null;
}

/** First server-configured reply model wins. No browser-supplied model keys. */
function envProvider(): { slug: AiProviderSlug; key: string } | null {
  const order: AiProviderSlug[] = ["anthropic", "openai", "groq", "mistral", "xai"];
  for (const slug of order) {
    const key = process.env[PROVIDER_ENV[slug]] ?? "";
    if (key && CLOUD_ENDPOINT[slug]) return { slug, key };
  }
  return null;
}

async function loadWorkspaceAutopilotArmed(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ entitled: boolean; entitledId: string; sequencesArmed: boolean }> {
  const entitled = await supabase
    .from("profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("autopilot_enabled", true)
    .in("role", ["admin", "member"])
    .limit(1)
    .maybeSingle();
  const entitledId = typeof entitled.data?.id === "string" ? entitled.data.id : "";
  if (!entitledId) {
    return { entitled: false, entitledId: "", sequencesArmed: false };
  }
  const controls = await loadSourcingLoopControls(supabase, workspaceId);
  const sequencesArmed = controls.ok && sequencesArmedFromControls(controls.row);
  return { entitled: true, entitledId, sequencesArmed };
}

async function settleInbound(
  supabase: SupabaseClient,
  inboundId: string,
  claimId: string,
  outcome: "processed" | "triage" | "retry",
  reason?: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_whatsapp_inbound_processing", {
    p_inbound_id: inboundId,
    p_claim_id: claimId,
    p_outcome: outcome,
    p_error: reason ?? null,
  });
  const result = data as { ok?: boolean } | null;
  if (!error && result?.ok === true) return true;
  safeLog("whatsapp inbound: completion update failed", { message: error?.message ?? "no result", outcome });
  return false;
}

/** Compose exactly once for a durable inbound row. A lease-backed database claim
 * prevents duplicate LLM calls when Meta redelivers while recovery is running. */
export async function processStoredWhatsAppInbound(
  supabase: SupabaseClient,
  input: { inboundId: string; senderId: string },
): Promise<WhatsAppInboundProcessResult> {
  const { data, error } = await supabase.rpc("claim_whatsapp_inbound_processing", {
    p_inbound_id: input.inboundId,
    p_sender_id: input.senderId,
  });
  const claim = data as InboundClaim | null;
  if (error || claim?.ok !== true) {
    const reason = error?.message ?? claim?.reason ?? "claim-failed";
    const isBenign = claim?.reason === "already-processed" || claim?.reason === "already-claimed";
    if (!isBenign) safeLog("whatsapp inbound: processing claim failed", { message: reason });
    return { outcome: isBenign ? "skipped" : "retry", reason };
  }

  const claimId = claim.claim_id;
  const workspaceId = claim.workspace_id;
  const senderId = claim.sender_id;
  const recipient = claim.from_address;
  const body = claim.body;
  const providerId = claim.provider_id;
  const receivedAt = claim.received_at;
  if (!claimId || !workspaceId || !senderId || !recipient || typeof body !== "string" || !receivedAt) {
    const settled = claimId
      ? await settleInbound(supabase, input.inboundId, claimId, "retry", "incomplete-processing-claim")
      : false;
    return { outcome: settled ? "retry" : "retry", reason: "incomplete-processing-claim" };
  }

  const complete = async (outcome: "processed" | "triage", reason?: string): Promise<WhatsAppInboundProcessResult> => {
    const settled = await settleInbound(supabase, input.inboundId, claimId, outcome, reason);
    return settled
      ? { outcome, reason: reason ?? outcome }
      : { outcome: "retry", reason: "completion-update-failed" };
  };
  const retry = async (reason: string): Promise<WhatsAppInboundProcessResult> => {
    await settleInbound(supabase, input.inboundId, claimId, "retry", reason);
    return { outcome: "retry", reason };
  };

  try {
    if (isWhatsAppOptOut(body)) {
      const { error: contactErr } = await supabase.from("whatsapp_contacts").upsert(
        {
          workspace_id: workspaceId,
          recipient_e164: recipient,
          consent_status: "opted_out",
          consent_source: "candidate-message",
          consent_evidence: { provider_message_id: providerId },
          recorded_at: receivedAt,
          expires_at: null,
          revoked_at: receivedAt,
          revoked_reason: "candidate-opt-out",
          last_inbound_at: receivedAt,
        },
        { onConflict: "workspace_id,recipient_e164" },
      );
      if (contactErr) return retry("opt-out-contact-write-failed");

      const { error: suppressErr } = await supabase.from("suppression_list").upsert(
        {
          workspace_id: workspaceId,
          type: "phone",
          value: recipient,
          reason: "Candidate requested WhatsApp opt-out.",
          source: "WhatsApp candidate message",
        },
        { onConflict: "workspace_id,type,value" },
      );
      if (suppressErr) return retry("opt-out-suppression-write-failed");

      const { error: cancelErr } = await supabase
        .from("messages_outbound")
        .update({ status: "blocked", gate_result: { pass: false, reasons: ["whatsapp:opted-out"] } })
        .eq("workspace_id", workspaceId)
        .eq("channel", "WhatsApp")
        .eq("recipient_e164", recipient)
        .in("status", ["composed", "queued"]);
      if (cancelErr) return retry("opt-out-cancellation-failed");
      return complete("processed", "opt-out-recorded");
    }

    const { error: contactErr } = await supabase
      .from("whatsapp_contacts")
      .update({ last_inbound_at: receivedAt })
      .eq("workspace_id", workspaceId)
      .eq("recipient_e164", recipient)
      .eq("consent_status", "opted_in");
    if (contactErr) return retry("contact-window-update-failed");

    const windowEnd = new Date(new Date(receivedAt).getTime() + 24 * 60 * 60 * 1_000).toISOString();
    const { error: windowErr } = await supabase.from("whatsapp_conversation_windows").upsert(
      {
        workspace_id: workspaceId,
        sender_id: senderId,
        recipient_e164: recipient,
        last_inbound_message_id: providerId ?? input.inboundId,
        last_inbound_at: receivedAt,
        freeform_until: windowEnd,
      },
      { onConflict: "workspace_id,sender_id,recipient_e164" },
    );
    if (windowErr) return retry("reply-window-write-failed");

    // Reply identity comes from the canonical conversation (provider-scoped
    // thread key: registered sender + candidate address), never from whichever
    // outbound row happened to be written last for the bare phone number.
    // Unknown ('no-conversation') and ambiguous ('ambiguous-conversation')
    // threads fail closed into durable triage — the completion path retains
    // the reason as last_processing_error for the operator.
    const { data: convoData, error: convoErr } = await supabase.rpc(
      "resolve_whatsapp_inbound_conversation",
      { p_inbound_id: input.inboundId, p_claim_id: claimId },
    );
    const convo = convoData as ResolvedConversation | null;
    if (convoErr) return retry("conversation-resolve-failed");
    if (!convo || convo.ok !== true) return complete("triage", convo?.reason ?? "no-conversation");
    const conversationId = convo.conversation_id;
    const conversationCandidateId = convo.candidate_id;
    if (!conversationId || !conversationCandidateId) return complete("triage", "no-conversation");
    if (!convo.spec_id || !convo.owner_id) return complete("triage", "agent-spec-unavailable");

    const { data: spec, error: specErr } = await supabase
      .from("agent_specs")
      .select("id, seat_id, role_brief, guardrails, status")
      .eq("id", convo.spec_id)
      .eq("workspace_id", workspaceId)
      .eq("owner_id", convo.owner_id)
      .maybeSingle();
    if (specErr) return retry("agent-spec-lookup-failed");
    if (!spec || spec.status !== "active") return complete("triage", "agent-spec-unavailable");

    // Prompt context only, never identity: the latest outbound inside THIS
    // conversation's agent thread (scoped by the resolved spec + recipient).
    const { data: lastOutbound, error: lastOutboundErr } = await supabase
      .from("messages_outbound")
      .select("body")
      .eq("workspace_id", workspaceId)
      .eq("owner_id", convo.owner_id)
      .eq("conversation_id", conversationId)
      .eq("spec_id", convo.spec_id)
      .eq("to_address", recipient)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastOutboundErr) return retry("thread-context-lookup-failed");

    const provider = envProvider();
    if (!provider) return retry("reply-provider-unavailable");
    const brief = spec.role_brief as { title?: string; seniority?: string } & Record<string, unknown>;
    const { system, prompt } = buildReplyPrompt({
      inbound: body,
      lastOutbound: lastOutbound?.body ?? "",
      roleSummary: candidateDisclosureContextForCampaignLike(brief).slice(0, 2_000),
    });
    const request = buildCloudRequest(provider.slug, DEFAULT_MODEL[provider.slug], system, prompt, provider.key, 512);
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return retry("reply-provider-failed");
    const draft = parseCloudResponse(provider.slug, await response.json());
    if (!draft.trim()) return retry("empty-reply-draft");

    const guardrails = (spec.guardrails ?? {}) as SpecGuardrails;
    const salaryMin = typeof brief.salaryMin === "number" ? brief.salaryMin : null;
    const salaryMax = typeof brief.salaryMax === "number" ? brief.salaryMax : null;
    const forbidden = [brief.department, brief.teamSize, brief.reportingTo, brief.currency]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const arm = await loadWorkspaceAutopilotArmed(supabase, workspaceId);
    // Spec guardrails historically lock autopilot:false + canary>0. When the
    // workspace Autopilot arm is on, trust entitlement for eligibility and keep
    // disclosure / injection / human-likeness gate checks from decideAutopilot.
    const effectiveGuardrails: SpecGuardrails =
      arm.entitled && arm.sequencesArmed
        ? { ...guardrails, autopilot: true, canary_remaining: 0 }
        : guardrails;
    const decision = decideAutopilot(draft, effectiveGuardrails, { salaryMin, salaryMax, forbidden }, {
      autopilotEnabled: arm.entitled && arm.sequencesArmed,
    });
    if (detectInjection(body).flagged && !decision.reasons.includes("injection-suspected")) {
      decision.reasons.push("injection-suspected");
    }
    const reviewDraftDedupeHash = dedupeHash(conversationCandidateId, "WhatsApp", decision.text);

    // Autopilot ON + Sequences + clean decision + live critics → mint + queue.
    // Otherwise store blocked for the Replies human-review surface.
    const mayAutoQueue =
      decision.action === "auto_approve_eligible" &&
      arm.entitled &&
      arm.sequencesArmed &&
      arm.entitledId &&
      !decision.reasons.includes("injection-suspected");

    if (mayAutoQueue) {
      const { validateOutreachQualityLive } = await import("@/lib/outreach-quality-pipeline-live");
      const liveVerdict = await validateOutreachQualityLive({
        subject: "",
        body: decision.text,
        channel: "WhatsApp",
        workspaceId,
      });
      if (liveVerdict.llmCriticsUsed === true && liveVerdict.status === "ready") {
      const outboundId = randomUUID();
      const subject = "";
      const bodyHash = approvalHash(subject, decision.text);
      const scopeHash = approvalScopeHash({
        candidateId: conversationCandidateId,
        channel: "WhatsApp",
        recipient,
      });
      if (scopeHash) {
        const minted = await supabase.rpc("mint_autopilot_critics_approval", {
          p_workspace_id: workspaceId,
          p_message_id: outboundId,
          p_body_hash: bodyHash,
          p_approval_scope_hash: scopeHash,
          p_entitled_approver_id: arm.entitledId,
        });
        const mintStatus =
          minted.data && typeof minted.data === "object" && "status" in minted.data
            ? String((minted.data as { status: string }).status)
            : "";
        if (!minted.error && mintStatus === "ok") {
          const { error: outboundErr } = await supabase.from("messages_outbound").insert({
            id: outboundId,
            workspace_id: workspaceId,
            owner_id: convo.owner_id,
            inbound_message_id: input.inboundId,
            conversation_id: conversationId,
            spec_id: spec.id,
            candidate_id: conversationCandidateId,
            seat_id: spec.seat_id,
            channel: "WhatsApp",
            to_address: recipient,
            recipient_e164: recipient,
            type: "candidate_reply",
            subject,
            body: decision.text,
            status: "queued",
            gate_result: { pass: true, reasons: decision.reasons },
            dedupe_hash: reviewDraftDedupeHash,
            scheduled_at: new Date().toISOString(),
            approval_message_id: outboundId,
          });
          if (!outboundErr) {
            try {
              await dispatchDue(supabase, 1, outboundId);
            } catch (err) {
              safeLog("whatsapp inbound: autopilot dispatch error", {
                message: err instanceof Error ? err.message : "unknown",
              });
            }
            return complete("processed");
          }
          if (outboundErr.code === "23505") {
            const { data: existingDraft, error: existingDraftErr } = await supabase
              .from("messages_outbound")
              .select("inbound_message_id")
              .eq("workspace_id", workspaceId)
              .eq("inbound_message_id", input.inboundId)
              .maybeSingle();
            if (existingDraftErr) return retry("review-draft-conflict-lookup-failed");
            if (existingDraft?.inbound_message_id === input.inboundId) {
              return complete("processed");
            }
            return complete("triage", "review-draft-dedupe-conflict");
          }
          safeLog("whatsapp inbound: autopilot queue insert failed", {
            message: outboundErr.message,
            code: outboundErr.code,
          });
        }
      }
      }
    }

    const { error: outboundErr } = await supabase.from("messages_outbound").insert({
      workspace_id: workspaceId,
      owner_id: convo.owner_id,
      inbound_message_id: input.inboundId,
      conversation_id: conversationId,
      spec_id: spec.id,
      candidate_id: conversationCandidateId,
      seat_id: spec.seat_id,
      channel: "WhatsApp",
      to_address: recipient,
      recipient_e164: recipient,
      type: "candidate_reply",
      body: decision.text,
      status: "blocked",
      gate_result: { pass: false, reasons: decision.reasons },
      dedupe_hash: reviewDraftDedupeHash,
      scheduled_at: null,
    });
    if (outboundErr?.code === "23505") {
      // A unique conflict only proves idempotency when the previously stored
      // review row belongs to this exact inbound event. A same-text collision
      // from another candidate reply must remain visible for manual triage.
      const { data: existingDraft, error: existingDraftErr } = await supabase
        .from("messages_outbound")
        .select("inbound_message_id")
        .eq("workspace_id", workspaceId)
        .eq("inbound_message_id", input.inboundId)
        .maybeSingle();
      if (existingDraftErr) return retry("review-draft-conflict-lookup-failed");
      if (existingDraft?.inbound_message_id !== input.inboundId) {
        return complete("triage", "review-draft-dedupe-conflict");
      }
    } else if (outboundErr) {
      return retry("review-draft-write-failed");
    }

    return complete("processed");
  } catch (err) {
    safeLog("whatsapp inbound: processing error", { message: err instanceof Error ? err.message : "unknown" });
    return retry("unexpected-processing-error");
  }
}

/** Daily and webhook-triggered backstop for rows whose first processing attempt
 * failed after durable storage. Rows without a safe sender mapping are never
 * guessed and remain for manual triage. */
export async function recoverPendingWhatsAppInbound(
  supabase: SupabaseClient,
  limit = 10,
): Promise<{ attempted: number; recovered: number; retryable: number }> {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("messages_inbound")
    .select("id, whatsapp_sender_id")
    .eq("channel", "WhatsApp")
    .eq("processed", false)
    .not("whatsapp_sender_id", "is", null)
    .or(`processing_lease_until.is.null,processing_lease_until.lte.${now}`)
    .order("received_at", { ascending: true })
    .limit(boundedLimit);
  if (error) {
    safeLog("whatsapp inbound: recovery select failed", { message: error.message });
    return { attempted: 0, recovered: 0, retryable: 1 };
  }

  let attempted = 0;
  let recovered = 0;
  let retryable = 0;
  for (const row of (data ?? []) as StoredInboundRow[]) {
    if (!row.whatsapp_sender_id) continue;
    attempted++;
    const result = await processStoredWhatsAppInbound(supabase, { inboundId: row.id, senderId: row.whatsapp_sender_id });
    if (result.outcome === "processed" || result.outcome === "triage") recovered++;
    if (result.outcome === "retry") retryable++;
  }
  return { attempted, recovered, retryable };
}
