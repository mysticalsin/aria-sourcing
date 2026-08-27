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

function extractMessageId(
  resource: string | undefined,
  resourceData: { id?: string; "@odata.id"?: string } | undefined,
): string {
  const direct = resourceData?.id?.trim();
  if (direct) return direct;

  const odataId = resourceData?.["@odata.id"]?.trim();
  const fromOdata =
    (odataId && (/\/Messages\('([^']+)'\)/i.exec(odataId) || /\/messages\/(.+?)(?:\?|$)/i.exec(odataId))) ||
    null;
  if (fromOdata?.[1]) return decodeURIComponent(fromOdata[1]);

  if (!resource) return "";
  const quoted = /\/Messages\('([^']+)'\)/i.exec(resource);
  if (quoted?.[1]) return decodeURIComponent(quoted[1]);
  // Path form: take everything after the last /messages/ (IDs may contain '/').
  const pathIdx = resource.toLowerCase().lastIndexOf("/messages/");
  if (pathIdx >= 0) {
    const rest = resource.slice(pathIdx + "/messages/".length).split(/[?#]/)[0];
    if (rest) return decodeURIComponent(rest);
  }
  return "";
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

    const messageId = extractMessageId(note.resource, note.resourceData);
    if (!messageId) {
      results.push({ subscriptionId: note.subscriptionId, status: "missing_message_id" });
      continue;
    }

    const fetched = await fetchGraphMessageForIngest({
      workspaceId: sub.workspace_id,
      connectionId: sub.connection_id,
      messageId,
    });
    if (!fetched.ok) {
      // Fail closed — never invents a hiring-need enqueue. Map reasons explicitly
      // so audits can pin non-retryable Graph-absent statuses:
      // connection_missing | token_unavailable | message_incomplete | message_fetch_failed
      const status =
        fetched.reason === "connection_missing"
          ? "connection_missing"
          : fetched.reason === "token_unavailable"
            ? "token_unavailable"
            : fetched.reason === "message_incomplete"
              ? "message_incomplete"
              : "message_fetch_failed";
      results.push({ subscriptionId: note.subscriptionId, status });
      continue;
    }
    const message = fetched.message;

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

  // Retryable failures: ask Graph to redeliver (503). Keep 202 for success and
  // non-retryable gaps (unknown sub, client_state, connection_missing,
  // token_unavailable, message_incomplete) so Graph does not spin when MS is absent.
  const retryable = results.some(
    (r) =>
      r.status === "message_fetch_failed"
      || r.status === "ingest_503"
      || r.status.startsWith("ingest_5"),
  );
  if (retryable) {
    return NextResponse.json({ ok: false, results }, { status: 503 });
  }
  return NextResponse.json({ ok: true, results }, { status: 202 });
}
