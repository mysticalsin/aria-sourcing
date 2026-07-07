/* ============================================================================
   Tiny in-memory pub/sub for agent activity — the whole app reuses this one
   singleton so the floor (and anything else) can react to store actions in
   real time without adding any persisted state. Store actions call `emit()`
   right after they've actually succeeded; subscribers (e.g. the 3D floor,
   a HUD, an activity ticker) call `subscribe()`. Crash-safe by design: a
   throwing subscriber can never break the store action that emitted.
   ========================================================================== */

export type AgentEvent = {
  seatId?: string;
  kind: "source" | "send" | "reply" | "book" | "allocate";
  candidateName?: string;
  campaignId?: string;
  count?: number;
  at: number;
};

const CAPACITY = 64;

const buffer: AgentEvent[] = [];
const subscribers = new Set<(e: AgentEvent) => void>();

/** Stamp `at`, push onto the bounded ring buffer, and notify every subscriber.
 *  Never throws — a subscriber error is caught and swallowed so it can never
 *  break the store action that emitted the event. */
export function emit(e: Omit<AgentEvent, "at"> & { at?: number }): void {
  const event: AgentEvent = { ...e, at: e.at ?? Date.now() };
  buffer.push(event);
  if (buffer.length > CAPACITY) buffer.shift();
  subscribers.forEach((fn) => {
    try {
      fn(event);
    } catch {
      /* a misbehaving subscriber must never break the emitting action */
    }
  });
}

/** Subscribe to future events. Returns an unsubscribe function. */
export function subscribe(fn: (e: AgentEvent) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** A copy of the recent-events ring buffer (most recent last). */
export function recentEvents(): AgentEvent[] {
  return [...buffer];
}
