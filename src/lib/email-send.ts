/* ============================================================================
   performEmailSend — the ONLY email-to-provider primitive.

   Given a LIVE, domain-verified seat, a prepared one-click unsubscribe URL, and
   an RFC Message-ID minted by the durable claim, send exactly one message from
   the seat's own mailbox (Gmail API / Microsoft Graph via stored OAuth, or an
   SMTP-style REST provider). It NEVER throws for a transport failure — it returns
   a deliveryState so the caller reconciles the ledger:
     accepted  -> ledger 'sent'
     not-sent  -> ledger 'skipped'   (provably pre-transport; retryable)
     unknown   -> ledger 'ambiguous' (may have been accepted; hold the slot)

   Extracted verbatim from /api/outreach/send so the interactive route and the
   headless dispatcher share one gate-identical send path (never a second, drifted
   implementation). The From address is always the seat's verified mailbox, never
   caller-supplied.
   ========================================================================== */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendViaProvider, type SendRequest } from "@/lib/providers";
import { sendViaGmailApi, sendViaMicrosoftGraph } from "@/lib/email-oauth";
import { encryptSecret, decryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import { safeLog } from "@/lib/log-redact";
import { mantuEmailHtmlWrapper } from "@/lib/mantu-brand";
import type { EmailConnection } from "@/lib/types";

export interface PerformEmailSendParams {
  /** The claimed row's workspace — used to defensively confirm the connection. */
  workspaceId: string;
  seatId: string;
  /** The seat's provider (Gmail API | Microsoft Graph | Resend | SendGrid | …). */
  provider: string;
  /** The verified From mailbox — always the seat's, never the request body. */
  operatorEmail: string;
  to: string;
  subject: string;
  body: string;
  /** Optional prebuilt HTML; when omitted, Mantu brand wrapper is applied server-side. */
  htmlBody?: string;
  unsubscribeUrl: string;
  attemptId: string;
  /** "<uuid@domain>" minted by claim_email_outbound_queued, stamped as Message-ID. */
  rfcMessageId: string;
}

export interface EmailSendOutcome {
  status: "sent" | "dry-run" | "error";
  deliveryState: "accepted" | "not-sent" | "unknown";
  detail: string;
  id?: string;
}

export async function performEmailSend(
  service: SupabaseClient,
  params: PerformEmailSendParams,
): Promise<EmailSendOutcome> {
  const { workspaceId, seatId, provider, operatorEmail, to, subject, body, unsubscribeUrl, attemptId, rfcMessageId } = params;
  // Always brand candidate-facing HTML on the server from the approved plain body —
  // never trust client-supplied HTML for MIME.
  const htmlBody = params.htmlBody?.trim() || mantuEmailHtmlWrapper(body);

  if (provider === "Gmail API" || provider === "Microsoft Graph") {
    // Defence-in-depth workspace check: the service role bypasses RLS, so verify
    // the resolved connection belongs to the claimed row's workspace.
    const { data: conn } = await service
      .from("email_connections")
      .select("id, access_token, refresh_token, expires_at, scope, account_email, workspace_id")
      .eq("seat_id", seatId)
      .single();
    if (!conn || conn.workspace_id !== workspaceId) {
      return { status: "dry-run", deliveryState: "not-sent", detail: `${provider} mailbox not connected.` };
    }

    // Tokens are stored encrypted at rest; decrypt for use. Keep the decrypted
    // original to detect a refresh below.
    const origAccessToken = decryptSecret(conn.access_token);
    const connection: EmailConnection = {
      id: conn.id,
      seatId,
      provider,
      accountEmail: conn.account_email,
      accessToken: origAccessToken,
      refreshToken: conn.refresh_token ? decryptSecret(conn.refresh_token) : conn.refresh_token,
      expiresAt: conn.expires_at,
      scope: conn.scope,
      connectedAt: "",
      updatedAt: "",
    };

    const req = {
      from: operatorEmail,
      to,
      subject,
      body,
      htmlBody,
      unsubscribeUrl,
      attemptId,
      messageId: rfcMessageId,
    };
    const outcome =
      provider === "Gmail API"
        ? await sendViaGmailApi(req, connection)
        : await sendViaMicrosoftGraph(req, connection);

    // Persist a refreshed token if it changed — best-effort, AFTER the send
    // outcome is known. Fail closed: never write a refreshed token in cleartext
    // when production requires encryption at rest but no key is configured.
    if (
      (origAccessToken !== connection.accessToken
        || conn.expires_at !== connection.expiresAt
        || (connection.scope ?? "") !== (conn.scope ?? "")) &&
      !encryptionRequiredButMissing()
    ) {
      try {
        await service
          .from("email_connections")
          .update({
            access_token: encryptSecret(connection.accessToken),
            expires_at: connection.expiresAt,
            scope: connection.scope ?? conn.scope,
            updated_at: new Date().toISOString(),
          })
          .eq("id", connection.id);
      } catch (persistErr) {
        safeLog("performEmailSend refreshed token persist error", { message: persistErr instanceof Error ? persistErr.message : "unknown" });
      }
    }

    return { status: outcome.status, deliveryState: outcome.deliveryState, detail: outcome.detail, id: outcome.id };
  }

  const outcome = await sendViaProvider({
    provider: provider as SendRequest["provider"],
    from: operatorEmail,
    to,
    subject,
    body,
    htmlBody,
    unsubscribeUrl,
    attemptId,
    messageId: rfcMessageId,
  });
  return { status: outcome.status, deliveryState: outcome.deliveryState, detail: outcome.detail, id: outcome.id };
}
