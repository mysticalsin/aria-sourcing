// Experimental LinkedIn bridge: the signed-in user's pairing.
//   GET    status of the extension and of the synced LinkedIn account
//   POST   pair (or re-pair) the extension; returns the token once
//   DELETE disconnect and delete everything synced for this user

import type { NextRequest } from "next/server";
import { readBridgePolicy } from "@/lib/linkedin-bridge/policy";
import {
  accountForUser,
  deleteAccount,
  okJson,
  pairAccount,
  recentSendTimes,
  requireBridgeUser,
  serverError,
} from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The extension polls every minute; three missed polls means it is offline. */
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  try {
    const account = await accountForUser(auth.ctx);
    const policy = readBridgePolicy();
    if (!account) {
      return okJson({ paired: false, policy: { dailySendCap: policy.dailySendCap, sentLast24h: 0 } });
    }
    const now = new Date();
    const sent = await recentSendTimes(auth.ctx.svc, account.id, now);
    const lastSeen = account.last_seen_at ? Date.parse(account.last_seen_at) : null;
    return okJson({
      paired: true,
      account: {
        pairedAt: account.paired_at,
        memberId: account.member_id,
        displayName: account.display_name,
        publicIdentifier: account.public_identifier,
        extensionVersion: account.extension_version,
        sessionPresent: account.session_present,
        online: lastSeen !== null && now.getTime() - lastSeen < ONLINE_WINDOW_MS,
        lastSeenAt: account.last_seen_at,
        lastInboxSyncAt: account.last_inbox_sync_at,
        backoffUntil: account.backoff_until,
        lastError: account.last_error,
        lastErrorAt: account.last_error_at,
      },
      policy: {
        dailySendCap: policy.dailySendCap,
        minSendIntervalSeconds: Math.round(policy.minSendIntervalMs / 1000),
        sentLast24h: sent.filter((t) => t > now.getTime() - 24 * 60 * 60 * 1000).length,
      },
    });
  } catch {
    return serverError("LinkedIn bridge status unavailable.");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  try {
    const token = await pairAccount(auth.ctx);
    return okJson({ token });
  } catch {
    return serverError("Pairing failed.");
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  try {
    await deleteAccount(auth.ctx);
    return okJson({ deleted: true });
  } catch {
    return serverError("Disconnect failed.");
  }
}
