/* ============================================================================
   Pure, framework-agnostic helpers shared between the 3D packet-FX layer
   (PacketFX.tsx, mounted inside the <Canvas>) and the 2D activity ticker
   (src/app/floor/page.tsx, outside it). Deliberately has ZERO three.js /
   @react-three/fiber imports so importing it from the floor page never pulls
   the 3D bundle into the main chunk — Floor3D stays behind
   next/dynamic(..., { ssr: false }).
   ========================================================================== */

import type { AgentEvent } from "@/lib/agent-events";
import type { SoundKind } from "@/lib/sound";

/** Packet/pulse color per event kind — cyan=source, tangerine=allocate/send
 *  (approved draft), red=reply, violet=book. Kept in the same hue family as
 *  ROBOT_PALETTE (src/lib/floor3d.ts). */
export const EVENT_COLOR: Record<AgentEvent["kind"], string> = {
  source: "#22D3EE",
  allocate: "#F97316",
  send: "#F97316",
  reply: "#EF4444",
  book: "#8B5CF6",
};

/** WebAudio cue per event kind (src/lib/sound.ts extends SoundKind with
 *  exactly these four — allocate and send share "ping" by design). */
export const EVENT_SOUND: Record<AgentEvent["kind"], SoundKind> = {
  source: "packet",
  allocate: "ping",
  send: "ping",
  reply: "beacon",
  book: "chord",
};

/** How long a seat's forced "working" pulse / glow lasts after it's chosen
 *  as an event's responder. agentTick's own DESK_STICKY_MS (10s) takes over
 *  the walk-to-desk animation after that, so this only needs to last long
 *  enough to be observed and to survive at least one render tick. */
export const PULSE_MS = 4000;

/** Flight duration for a packet sprite, source → hub (PacketFX.tsx). */
export const PACKET_FLIGHT_MS = 850;

/**
 * The event bus (src/lib/agent-events.ts) doesn't currently carry a seatId —
 * no store action attributes an emit to a specific seat — so "the emitting
 * seat" has to be resolved to *some* concrete robot for the reaction to be
 * visible at all. This deterministic hash of the event's own fields picks
 * the same index every time the same event is seen by any subscriber, so the
 * 2D status-flip (floor/page.tsx) and the 3D packet source (PacketFX.tsx)
 * always agree on which robot reacts — with no shared mutable state between
 * them. If a future store change starts populating `seatId`, callers should
 * prefer it directly and only fall back to this hash when it's absent.
 */
export function pickResponderIndex(e: AgentEvent, n: number): number {
  if (n <= 0) return 0;
  const key = `${e.kind}:${e.campaignId ?? ""}:${e.candidateName ?? ""}:${e.count ?? ""}:${e.at}`;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % n;
}

/** One-line human description of an event for the 2D activity ticker. */
export function describeEvent(e: AgentEvent, seatName?: string | null): string {
  const who = seatName ? ` · ${seatName}` : "";
  switch (e.kind) {
    case "source":
      return `Sourced ${e.count ?? "new"} candidate${e.count === 1 ? "" : "s"}${who}`;
    case "allocate":
      return e.candidateName
        ? `Drafted outreach for ${e.candidateName}${who}`
        : `Drafted ${e.count ?? ""} outreach draft${e.count === 1 ? "" : "s"}${who}`;
    case "send":
      return `Approved outreach${e.candidateName ? ` to ${e.candidateName}` : ""}${who}`;
    case "reply":
      return `Reply received${e.candidateName ? ` from ${e.candidateName}` : ""}${who}`;
    case "book":
      return `Interview booked${e.candidateName ? ` with ${e.candidateName}` : ""}${who}`;
    default:
      return "Agent activity";
  }
}
