import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { safeLog } from "@/lib/log-redact";
import {
  verifyMetaSignature,
  parseWhatsAppWebhook,
  buildReplyPrompt,
  decideAutopilot,
  type SpecGuardrails,
} from "@/lib/autopilot";
import { dedupeHash, nextSendTime } from "@/lib/gate";
import { dispatchDue } from "@/lib/dispatch-outbound";
import {
  CLOUD_ENDPOINT,
  PROVIDER_ENV,
  DEFAULT_MODEL,
  buildCloudRequest,
  parseCloudResponse,
  type AiProviderSlug,
} from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

/**
 * WhatsApp Cloud API webhook — the inbound half of gated autopilot.
 *
 * GET: Meta's one-time subscription handshake (hub.challenge echo).
 * POST: signature-verified message delivery. Each text message is stored in
 * messages_inbound (idempotent on provider message id), threaded to the
 * candidate via the latest outbound to that phone, answered by the reply
 * composer, and routed by decideAutopilot():
 *   - inside guardrails → messages_outbound status 'queued' with a
 *     human-paced scheduled_at + a system approval row (approved_by = the
 *     spec owner who enabled autopilot). /api/cron/dispatch-outbound re-gates
 *     and runs claim_and_record before the wire.
 *   - anything else → status 'blocked', visible in the Replies queue.
 *
 * Always answers 200 to Meta once the signature checks out — a processing
 * error must not trigger Meta's retry storm; failures are logged and the
 * inbound row stays processed=false for the next cron pass.
 */

const VERIFY_TOKEN = () => process.env.WHATSAPP_VERIFY_TOKEN ?? "";
const APP_SECRET = () => process.env.WHATSAPP_APP_SECRET ?? "";
// Single-workspace mapping for the Cloud API number (internal tool posture —
// same assumption as the env-resident WHATSAPP_TOKEN in channels.ts).
const WORKSPACE_ID = () => process.env.WHATSAPP_WORKSPACE_ID ?? "";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && VERIFY_TOKEN() && token === VERIFY_TOKEN()) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

/** First env-configured provider wins; the reply composer needs no tools. */
function envProvider(): { slug: AiProviderSlug; key: string } | null {
  const order: AiProviderSlug[] = ["anthropic", "openai", "groq", "mistral", "xai"];
  for (const slug of order) {
    const key = process.env[PROVIDER_ENV[slug]] ?? "";
    if (key && CLOUD_ENDPOINT[slug]) return { slug, key };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, signature, APP_SECRET())) {
    return NextResponse.json({ ok: false, reason: "Bad signature." }, { status: 401 });
  }

  const workspaceId = WORKSPACE_ID();
  const supabase = getServiceSupabase();
  if (!workspaceId || !supabase) {
    safeLog("whatsapp webhook: not configured", { hasWorkspace: !!workspaceId, hasSupabase: !!supabase });
    return NextResponse.json({ ok: true }); // ack; nothing we can store
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true }); // not JSON we understand; ack
  }

  for (const msg of parseWhatsAppWebhook(payload)) {
    try {
      // 1. Store inbound, idempotent on Meta's message id.
      const { data: inserted, error: insErr } = await supabase
        .from("messages_inbound")
        .insert({
          workspace_id: workspaceId,
          channel: "WhatsApp",
          from_address: msg.from,
          body: msg.text,
          provider_id: msg.providerId,
        })
        .select("id")
        .maybeSingle();
      if (insErr) {
        // Unique violation = Meta redelivery of a message we already handled.
        if (insErr.code !== "23505") safeLog("whatsapp inbound insert error", { message: insErr.message });
        continue;
      }
      if (!inserted) continue;

      // 2. Thread to the candidate/spec via the latest outbound to this phone.
      const { data: thread } = await supabase
        .from("messages_outbound")
        .select("candidate_id, spec_id, body")
        .eq("workspace_id", workspaceId)
        .eq("to_address", msg.from)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!thread?.spec_id) continue; // unknown sender — stays for human triage

      const { data: spec } = await supabase
        .from("agent_specs")
        .select("id, owner_id, seat_id, role_brief, guardrails, status")
        .eq("id", thread.spec_id)
        .maybeSingle();
      if (!spec || spec.status !== "active") continue;

      // 3. Compose a reply (env-key provider; skip silently if none configured).
      const provider = envProvider();
      if (!provider) continue;
      const brief = spec.role_brief as { title?: string; seniority?: string } & Record<string, unknown>;
      const { system, prompt } = buildReplyPrompt({
        inbound: msg.text,
        lastOutbound: thread.body,
        roleSummary: JSON.stringify(brief).slice(0, 2_000),
      });
      const reqSpec = buildCloudRequest(provider.slug, DEFAULT_MODEL[provider.slug], system, prompt, provider.key, 512);
      const res = await fetch(reqSpec.url, {
        method: "POST",
        headers: reqSpec.headers,
        body: reqSpec.body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        safeLog("whatsapp autopilot: LLM error", { status: res.status });
        continue;
      }
      const draft = parseCloudResponse(provider.slug, await res.json());
      if (!draft.trim()) continue;

      // 4. Gate + guardrails decide: schedule or hand to human.
      const guardrails = (spec.guardrails ?? {}) as SpecGuardrails;
      const decision = decideAutopilot(draft, guardrails);
      const hash = dedupeHash(thread.candidate_id, "WhatsApp", decision.text);
      const scheduled = decision.action === "send" ? nextSendTime(new Date(), hash) : null;

      const { data: outbound, error: outErr } = await supabase
        .from("messages_outbound")
        .insert({
          workspace_id: workspaceId,
          spec_id: spec.id,
          candidate_id: thread.candidate_id,
          seat_id: spec.seat_id,
          channel: "WhatsApp",
          to_address: msg.from,
          type: "candidate_reply",
          body: decision.text,
          status: decision.action === "send" ? "queued" : "blocked",
          gate_result: decision.action === "send" ? { pass: true } : { pass: false, reasons: decision.reasons },
          dedupe_hash: hash,
          scheduled_at: scheduled?.toISOString() ?? null,
        })
        .select("id")
        .maybeSingle();
      if (outErr) {
        // Unique dedupe_hash violation = this exact reply already exists.
        if (outErr.code !== "23505") safeLog("whatsapp outbound insert error", { message: outErr.message });
        continue;
      }

      // 5. Canary countdown: the first N autopilot replies always go to the
      // human queue; decrement even on 'queue' so the canary actually burns.
      if (guardrails.autopilot && (guardrails.canary_remaining ?? 0) > 0) {
        await supabase
          .from("agent_specs")
          .update({ guardrails: { ...guardrails, canary_remaining: (guardrails.canary_remaining ?? 0) - 1 } })
          .eq("id", spec.id);
      }

      // 6. Scheduled sends get the same server-side approval record a human
      // click would create — approved_by is the owner who opted this spec into
      // autopilot. The dispatcher (and /api/outreach/send) verify it.
      if (decision.action === "send" && outbound) {
        const bodyHash = createHash("sha256").update(`\n${decision.text}`).digest("hex");
        await supabase.from("outreach_approvals").insert({
          workspace_id: workspaceId,
          message_id: outbound.id,
          body_hash: bodyHash,
          approved_by: spec.owner_id,
        });
      }

      await supabase.from("messages_inbound").update({ processed: true }).eq("id", inserted.id);
    } catch (err) {
      safeLog("whatsapp webhook processing error", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // Opportunistic drain: Meta calls this webhook for every delivery/read
  // receipt too, so due queued messages go out with near-human latency even
  // though Vercel Hobby only allows a daily cron (the /api/cron backstop).
  try {
    await dispatchDue(supabase, 5);
  } catch (err) {
    safeLog("whatsapp webhook: drain error", { message: err instanceof Error ? err.message : "unknown" });
  }

  return NextResponse.json({ ok: true });
}
