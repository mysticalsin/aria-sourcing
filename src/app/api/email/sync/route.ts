// READ-ONLY. This route fetches inbound messages via HTTP GET only.
// It NEVER sends, modifies, marks-read, or deletes anything in the mailbox.
// Tokens are never logged or returned to the client.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { EmailConnection, Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { getAccessTokenForReading } from "@/lib/email-oauth";
import { encryptSecret, decryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import {
  listInboundGmail,
  getGmailMessage,
  listInboundGraph,
  getGraphMessage,
  type InboundMessage,
} from "@/lib/email-sync";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

/** Maximum messages returned across ALL connections in a single sync. */
const TOTAL_MESSAGE_CAP = 50;

/** Maximum body characters stored per message (avoids huge JSON payloads). */
const BODY_TRUNCATE = 8_000;

/** Maximum email connections processed per sync (prevents timeout on large workspaces). */
const MAX_CONNECTIONS = 10;

/** Soft wall-clock deadline per sync request (ms). Remaining connections defer to next run. */
const SYNC_DEADLINE_MS = 45_000;

export async function POST(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  // Supabase is required — no demo bypass for a route that touches live mailboxes.
  if (!supabaseEnabled) {
    return NextResponse.json(
      { ok: false, error: "Authentication backend not configured." },
      { status: 503 },
    );
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "No Supabase client." },
      { status: 500 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  const userId = user.id;

  // ── 2. Role check ──────────────────────────────────────────────────────────
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "source")) {
    return NextResponse.json(
      { ok: false, error: "Insufficient permissions." },
      { status: 403 },
    );
  }

  // ── 3. Rate limit ──────────────────────────────────────────────────────────
  // Sync is expensive (multiple upstream GETs per connection). 10/min per caller.
  const rl = checkRateLimit(
    rateLimitKey(req, "email-sync", userId),
    { windowMs: 60_000, max: 10 },
  );
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  // ── 4. Resolve workspace ───────────────────────────────────────────────────
  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) {
    return NextResponse.json(
      { ok: false, error: "Workspace not found." },
      { status: 400 },
    );
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", messages: [], errors: [], detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }

  // ── 5. Load email connections (service-role — bypasses RLS for secrets) ────
  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json(
      { ok: false, error: "Service client unavailable." },
      { status: 500 },
    );
  }

  const { data: rows, error: connErr } = await svc
    .from("email_connections")
    .select("id, workspace_id, seat_id, provider, account_email, access_token, refresh_token, expires_at, scope")
    .eq("workspace_id", wid);

  if (connErr) {
    console.error("[email-sync] email_connections query error", { code: connErr.code });
    return NextResponse.json(
      { ok: false, error: "Failed to load email connections." },
      { status: 500 },
    );
  }

  const connections = rows ?? [];
  const messages: (InboundMessage & { seatId: string })[] = [];
  const errors: string[] = [];
  let totalCollected = 0;
  let connectionsProcessed = 0;
  const deadline = Date.now() + SYNC_DEADLINE_MS;

  // ── 6. Sync each connection ────────────────────────────────────────────────
  for (const row of connections) {
    if (totalCollected >= TOTAL_MESSAGE_CAP) break;
    if (connectionsProcessed >= MAX_CONNECTIONS) {
      errors.push("Connection cap reached; remaining mailboxes will sync next run.");
      break;
    }
    if (Date.now() > deadline) {
      errors.push("Sync deadline reached; remaining mailboxes will sync next run.");
      break;
    }
    connectionsProcessed++;

    // Tokens are encrypted at rest; decrypt for use. Keep the decrypted original to
    // detect a refresh below.
    const origAccessToken = decryptSecret(row.access_token);
    const conn: EmailConnection = {
      id: row.id,
      seatId: row.seat_id,
      provider: row.provider,
      accountEmail: row.account_email,
      accessToken: origAccessToken,
      refreshToken: row.refresh_token ? decryptSecret(row.refresh_token) : row.refresh_token,
      expiresAt: row.expires_at,
      scope: row.scope ?? "",
      connectedAt: "",
      updatedAt: "",
    };

    // Get (and possibly refresh) the access token — never log it.
    const token = await getAccessTokenForReading(conn);
    if (!token) {
      errors.push(`No token for connection ${row.id} (${row.provider})`);
      continue;
    }

    // Persist a refreshed token if it changed. Fail closed: never write a refreshed
    // token in cleartext when production requires encryption at rest but no key is
    // configured — skip the persist (this sync still completes with the in-memory
    // token) rather than silently degrade the stored credential to plaintext.
    if (
      token !== origAccessToken ||
      conn.expiresAt !== row.expires_at
    ) {
      if (encryptionRequiredButMissing()) {
        errors.push(`Refreshed token for ${row.id} not persisted (server encryption key not configured).`);
      } else {
        await svc
          .from("email_connections")
          .update({
            access_token: encryptSecret(conn.accessToken),
            expires_at: conn.expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conn.id);
      }
    }

    const remaining = TOTAL_MESSAGE_CAP - totalCollected;

    if (row.provider === "Gmail API") {
      let stubs: { id: string; threadId: string }[] = [];
      try {
        stubs = await listInboundGmail(token, Math.min(remaining, 25));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Gmail list failed";
        errors.push(`Gmail list (${row.id}): ${msg}`);
        continue;
      }

      for (const stub of stubs) {
        if (totalCollected >= TOTAL_MESSAGE_CAP) break;
        try {
          const msg = await getGmailMessage(token, stub.id);
          if (msg) {
            const gmailBody = msg.body.length > BODY_TRUNCATE
              ? msg.body.slice(0, BODY_TRUNCATE) + "\n\n[… message truncated at 8000 characters; full message is in the mailbox]"
              : msg.body;
            messages.push({
              ...msg,
              body: gmailBody,
              seatId: conn.seatId,
            });
            totalCollected++;
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : "unknown";
          errors.push(`Gmail message ${stub.id}: ${detail}`);
        }
      }
    } else if (row.provider === "Microsoft Graph") {
      let stubs: { id: string; conversationId: string }[] = [];
      try {
        stubs = await listInboundGraph(token, Math.min(remaining, 25));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Graph list failed";
        errors.push(`Graph list (${row.id}): ${msg}`);
        continue;
      }

      for (const stub of stubs) {
        if (totalCollected >= TOTAL_MESSAGE_CAP) break;
        try {
          const msg = await getGraphMessage(token, stub.id);
          if (msg) {
            const graphBody = msg.body.length > BODY_TRUNCATE
              ? msg.body.slice(0, BODY_TRUNCATE) + "\n\n[… message truncated at 8000 characters; full message is in the mailbox]"
              : msg.body;
            messages.push({
              ...msg,
              body: graphBody,
              seatId: conn.seatId,
            });
            totalCollected++;
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : "unknown";
          errors.push(`Graph message ${stub.id}: ${detail}`);
        }
      }
    } else {
      errors.push(`Unknown provider for connection ${row.id}: ${row.provider}`);
    }
  }

  // Log counts only — no token, no message bodies.
  console.log("[email-sync] sync complete", {
    connections: connections.length,
    messages: messages.length,
    errors: errors.length,
  });

  // ── 7. Return — tokens are NEVER in the response ───────────────────────────
  return NextResponse.json({ ok: true, messages, errors });
}
