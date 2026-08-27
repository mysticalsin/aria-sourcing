import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  fetchGraphMessageForIngest,
  lookupGraphSubscription,
  verifyGraphClientState,
} from "@/lib/email-graph-subscriptions";
import { ingestNormalizedInboundEmail } from "@/lib/inbound-email-ingest";
import { readBoundedBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Microsoft Graph change-notification endpoint for Outlook Inbox.
 * Handles validationToken challenges and batched created-message notifications.
 * Never polls — Graph pushes here when mail arrives.
 */

const WEBHOOK_MAX_BODY_BYTES = 2_000_000;

const NotificationSchema = z.object({
  value: z
    .array(
      z.object({
        subscriptionId: z.string().min(1).max(200),
        clientState: z.string().max(255).optional(),
        changeType: z.string().max(40).optional(),
        resource: z.string().max(2000).optional(),
        resourceData: z
          .object({
            id: z.string().min(1).max(512).optional(),
            "@odata.id": z.string().max(2000).optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});

function extractMessageId(resource: string | undefined, resourceDataId: string | undefined): string {
  if (resourceDataId?.trim()) return resourceDataId.trim();
  if (!resource) return "";
  const match = /\/Messages\('([^']+)'\)/i.exec(resource) || /\/messages\/([^/?]+)/i.exec(resource);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export async function GET(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json({ ok: false, reason: "Expected validationToken." }, { status: 400 });
}

export async function POST(req: NextRequest) {
  // Graph subscription validation: echo validationToken as plain text.
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let rawBody: string;
  try {
    rawBody = await readBoundedBody(req, WEBHOOK_MAX_BODY_BYTES);
  } catch {
    return NextResponse.json({ ok: false, reason: "Body too large." }, { status: 413 });
  }

  let parsed: z.infer<typeof NotificationSchema>;
  try {
    parsed = NotificationSchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid notification envelope." }, { status: 400 });
  }

  const results: Array<{ subscriptionId: string; status: string }> = [];

  for (const note of parsed.value) {
    const sub = await lookupGraphSubscription(note.subscriptionId);
    if (!sub) {
      results.push({ subscriptionId: note.subscriptionId, status: "unknown_subscription" });
      continue;
    }
    if (!verifyGraphClientState(note.clientState ?? "", sub.client_state_hash)) {
      results.push({ subscriptionId: note.subscriptionId, status: "client_state_mismatch" });
      continue;
    }

    const messageId = extractMessageId(note.resource, note.resourceData?.id);
    if (!messageId) {
      results.push({ subscriptionId: note.subscriptionId, status: "missing_message_id" });
      continue;
    }

    const message = await fetchGraphMessageForIngest({
      workspaceId: sub.workspace_id,
      connectionId: sub.connection_id,
      messageId,
    });
    if (!message) {
      results.push({ subscriptionId: note.subscriptionId, status: "message_fetch_failed" });
      continue;
    }

    const ingested = await ingestNormalizedInboundEmail({
      mailbox: message.mailbox,
      providerId: message.providerId,
      from: message.from,
      subject: message.subject,
      body: message.body,
      inReplyTo: message.inReplyTo,
    });

    if (ingested.ok) {
      const svc = getServiceSupabase();
      if (svc) {
        await svc
          .from("graph_mail_subscriptions")
          .update({ last_notification_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", sub.id);
      }
      results.push({
        subscriptionId: note.subscriptionId,
        status: ingested.jobQueued ? `queued:${ingested.jobKind}` : ingested.route,
      });
    } else {
      safeLog("graph webhook ingest failed", { reason: ingested.reason, status: ingested.status });
      results.push({ subscriptionId: note.subscriptionId, status: `ingest_${ingested.status}` });
    }
  }

  // Graph expects 202 quickly; we already processed synchronously (bounded batch).
  return NextResponse.json({ ok: true, results }, { status: 202 });
}
