/* ============================================================================
   LinkedIn bridge policy: feature flag, send pacing, sync cadence.

   Every message is written and sent by a person from the ARIA inbox; nothing
   here sends on its own. Pacing is a plain rate limit (a daily cap and a
   fixed gap between two sends) so a queue of messages never leaves as a
   burst. There is deliberately no random jitter or "human-like" timing: the
   owner decision of 2026-11-03 rules out bot-detection evasion.
   ========================================================================== */

export interface BridgePolicy {
  /** Messages per rolling 24 hours, per LinkedIn account. */
  dailySendCap: number;
  /** Minimum gap between two writes (messages and invitations alike). */
  minSendIntervalMs: number;
  /** Connection invitations per rolling 24 hours and per rolling 7 days. */
  dailyInviteCap: number;
  weeklyInviteCap: number;
  /** Profile reads per rolling 24 hours (LinkedIn counts them as profile views). */
  dailyLookupCap: number;
  /** Profile reads per poll. */
  lookupsPerPoll: number;
  /** How often a pending invitation is checked for acceptance. */
  pendingRecheckMs: number;
  /** How often the inbox list is refreshed while the extension is online. */
  inboxSyncIntervalMs: number;
  /** Faster refresh while the ARIA LinkedIn page is open and visible. */
  liveInboxSyncIntervalMs: number;
  /** Minimum gap between two refreshes triggered by LinkedIn activity. */
  activitySyncMinGapMs: number;
  /** Conversations whose messages are refreshed per poll. */
  threadRefreshPerPoll: number;
  /** Pause after LinkedIn answers 429 or asks for a security check. */
  backoffMs: number;
  /** How long a send may stay unconfirmed before it is marked unknown. */
  sendClaimMs: number;
}

function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function linkedInBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LINKEDIN_BRIDGE_ENABLED === "true";
}

export function readBridgePolicy(env: NodeJS.ProcessEnv = process.env): BridgePolicy {
  return {
    dailySendCap: intFromEnv(env.LINKEDIN_BRIDGE_DAILY_SEND_CAP, 40, 1, 150),
    minSendIntervalMs: intFromEnv(env.LINKEDIN_BRIDGE_MIN_SEND_INTERVAL_SECONDS, 90, 20, 3600) * 1000,
    dailyInviteCap: intFromEnv(env.LINKEDIN_BRIDGE_DAILY_INVITE_CAP, 15, 1, 100),
    weeklyInviteCap: intFromEnv(env.LINKEDIN_BRIDGE_WEEKLY_INVITE_CAP, 80, 1, 200),
    dailyLookupCap: intFromEnv(env.LINKEDIN_BRIDGE_DAILY_LOOKUP_CAP, 80, 1, 300),
    lookupsPerPoll: 1,
    pendingRecheckMs: 24 * 60 * 60 * 1000,
    inboxSyncIntervalMs: intFromEnv(env.LINKEDIN_BRIDGE_SYNC_SECONDS, 180, 60, 3600) * 1000,
    liveInboxSyncIntervalMs: intFromEnv(env.LINKEDIN_BRIDGE_LIVE_SYNC_SECONDS, 30, 15, 600) * 1000,
    activitySyncMinGapMs: 15_000,
    threadRefreshPerPoll: 2,
    backoffMs: 30 * 60 * 1000,
    sendClaimMs: 5 * 60 * 1000,
  };
}

export type SendSlot =
  | { allowed: true }
  | { allowed: false; reason: "daily_cap" | "min_interval"; retryAt: number };

/** Whether a message may go out now, given the account's recent sends. */
export function sendSlot(input: {
  now: number;
  /** sent_at of every message sent in the last 24 hours (any order). */
  recentSends: number[];
  policy: Pick<BridgePolicy, "dailySendCap" | "minSendIntervalMs">;
}): SendSlot {
  const { now, policy } = input;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = input.recentSends.filter((t) => t > dayAgo).sort((a, b) => a - b);
  if (recent.length >= policy.dailySendCap) {
    // The cap frees up when the oldest send of the window turns 24 hours old.
    const oldestCounted = recent[recent.length - policy.dailySendCap];
    return { allowed: false, reason: "daily_cap", retryAt: oldestCounted + 24 * 60 * 60 * 1000 };
  }
  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < policy.minSendIntervalMs) {
    return { allowed: false, reason: "min_interval", retryAt: last + policy.minSendIntervalMs };
  }
  return { allowed: true };
}

export type WriteKind = "message" | "invitation";

/**
 * Whether a write of this kind may go out now. `recent` lists the account's
 * writes of the last 7 days. The gap applies across kinds; caps per kind.
 */
export function writeSlot(input: {
  now: number;
  kind: WriteKind;
  recent: { kind: WriteKind; at: number }[];
  policy: Pick<BridgePolicy, "dailySendCap" | "minSendIntervalMs" | "dailyInviteCap" | "weeklyInviteCap">;
}): SendSlot {
  const { now, kind, policy } = input;
  const day = 24 * 60 * 60 * 1000;
  const sameKind = input.recent.filter((w) => w.kind === kind).map((w) => w.at);
  const caps: [number, number][] =
    kind === "message" ? [[day, policy.dailySendCap]] : [[day, policy.dailyInviteCap], [7 * day, policy.weeklyInviteCap]];
  let retryAt = 0;
  for (const [window, cap] of caps) {
    const inWindow = sameKind.filter((t) => t > now - window).sort((a, b) => a - b);
    if (inWindow.length >= cap) retryAt = Math.max(retryAt, inWindow[inWindow.length - cap] + window);
  }
  if (retryAt) return { allowed: false, reason: "daily_cap", retryAt };
  const last = Math.max(0, ...input.recent.map((w) => w.at).filter((t) => t > now - day));
  if (last && now - last < policy.minSendIntervalMs) {
    return { allowed: false, reason: "min_interval", retryAt: last + policy.minSendIntervalMs };
  }
  return { allowed: true };
}
