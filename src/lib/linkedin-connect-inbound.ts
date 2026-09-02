// Accepted connection requests (plan S5, sections 3.2 and 4). The vendor
// reports that a person accepted; this module stores the event, finds the
// launch that sent the request, and queues the first message the launch
// approved for that person two to ten minutes out, outside quiet hours, inside
// the workspace message cap. Every refusal leaves the event stored with a
// reason so a person can see it. Nothing is ever composed or sent from here
// without a campaign launch.

import { decideFirstMessageAfterAccept, type LoopConnectionAcceptedEvent } from "@/lib/linkedin-loop";
import type { LinkedInConnectStore } from "@/lib/linkedin-connect-store";
import type { LoopGrantRow } from "@/lib/linkedin-loop-store";

export interface ConnectionAcceptedDeps {
  store: LinkedInConnectStore;
  now?: () => Date;
}

export type ConnectionAcceptedResult =
  | { outcome: "scheduled"; eventId: string; messageId: string; sendAt: string }
  | { outcome: "held"; reason: string; eventId: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "retry"; reason: string };

export async function ingestLinkedInConnectionAccepted(
  deps: ConnectionAcceptedDeps,
  event: LoopConnectionAcceptedEvent,
): Promise<ConnectionAcceptedResult> {
  const now = deps.now?.() ?? new Date();
  const { store } = deps;

  // 1. Tenant. The webhook carries no workspace. The launch that owns the
  //    vendor campaign names one; otherwise the connect ledger does, and only
  //    when exactly one workspace asked this profile to connect. Never guessed.
  const campaignGrant = await store.findGrantForInbound({ vendorCampaignId: event.vendorCampaignId });
  const attempts = await store.findConnectAttempts(event.profileUrl);
  if (attempts === null) return { outcome: "retry", reason: "attempt-lookup-failed" };
  const inWorkspace = campaignGrant ? attempts.filter((a) => a.workspaceId === campaignGrant.workspaceId) : attempts;
  const workspaces = new Set(inWorkspace.map((a) => a.workspaceId));
  const workspaceId = campaignGrant?.workspaceId ?? (workspaces.size === 1 ? inWorkspace[0]!.workspaceId : null);
  if (!workspaceId) return { outcome: "skipped", reason: workspaces.size > 1 ? "ambiguous-tenant" : "no-connection-request" };

  // 2. The launch behind the request: the ledger's grant first, the vendor
  //    campaign's grant otherwise. Stored on the event before any decision.
  const attempt = inWorkspace[0] ?? null;
  let grant: LoopGrantRow | null = attempt ? await store.getGrant(attempt.grantId) : null;
  if (grant && grant.workspaceId !== workspaceId) grant = null;
  if (!grant && campaignGrant) grant = campaignGrant;

  // 3. Durable event, idempotent on the vendor event id.
  const receivedAt = new Date(Math.min(event.receivedAt, now.getTime() + 5 * 60_000)).toISOString();
  const inserted = await store.insertConnectEvent({
    workspaceId,
    grantId: grant?.id ?? null,
    profileUrl: event.profileUrl,
    providerId: event.providerId,
    receivedAt,
  });
  if (!inserted.ok) {
    if ("duplicate" in inserted) return { outcome: "skipped", reason: "duplicate-event" };
    return { outcome: "retry", reason: "event-write-failed" };
  }
  const eventId = inserted.id;
  const hold = async (reason: string): Promise<ConnectionAcceptedResult> => {
    await store.markConnectEvent(eventId, { status: "held", reason });
    return { outcome: "held", reason, eventId };
  };

  // 4. The fail-closed decision: campaign launch live, kill switch off,
  //    sending on, not suppressed, message cap left.
  const [controls, suppressed] = await Promise.all([store.readControls(workspaceId), store.isSuppressed(workspaceId, event.profileUrl)]);
  const messagesToday = controls ? await store.countWorkspaceMessagesToday(workspaceId, controls.timezone, now) : 0;
  if (messagesToday === null) return { outcome: "retry", reason: "message-count-unavailable" };
  const decision = decideFirstMessageAfterAccept({
    now,
    seed: eventId,
    grant,
    controls,
    optedOut: suppressed,
    messagesToday,
  });
  if (decision.action === "hold") return hold(decision.reason);

  // 5. Queue the first message the launch approved for this person. No draft,
  //    or a draft the launch did not approve, means a person writes it.
  const scheduled = await store.scheduleFirstMessageAfterAccept({
    workspaceId,
    grantId: grant!.id,
    campaignId: grant!.campaignId,
    profileUrl: event.profileUrl,
    scheduledAt: decision.sendAt.toISOString(),
  });
  if (!scheduled.ok) {
    if (scheduled.reason === "write-failed") return { outcome: "retry", reason: "first-message-write-failed" };
    return hold(scheduled.reason);
  }
  await store.markConnectEvent(eventId, { status: "scheduled", reason: null, outboundMessageId: scheduled.id });
  return { outcome: "scheduled", eventId, messageId: scheduled.id, sendAt: decision.sendAt.toISOString() };
}
