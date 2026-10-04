/**
 * Browser-durable LinkedIn channel events for open demo (no Supabase).
 * Survives refresh via localStorage; syncs across Settings Simulate → Replies inbox.
 */
import type { LinkedInEventType } from "@/lib/linkedin-events";

function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const LINKEDIN_DEMO_EVENTS_STORAGE_KEY = "hermes-sourcing:linkedin-events:v1";
export const LINKEDIN_DEMO_EVENTS_CHANGED = "aria:linkedin-demo-events";

export type LinkedInDemoChannelEvent = {
  id: string;
  event_id: string;
  event_type: LinkedInEventType | string;
  profile_url: string;
  body: string;
  candidate_id: string | null;
  inbound_id: string | null;
  conversation_id: string | null;
  occurred_at: string;
  created_at: string;
  payload?: Record<string, unknown>;
};

const MAX_EVENTS = 100;
const EMPTY_EVENTS: LinkedInDemoChannelEvent[] = [];

type StoreShape = { version: 1; events: LinkedInDemoChannelEvent[] };

let snapshotCacheRaw: string | null | undefined = undefined;
let snapshotCache: LinkedInDemoChannelEvent[] = EMPTY_EVENTS;

function emptyStore(): StoreShape {
  return { version: 1, events: [] };
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function parseStore(raw: string | null): StoreShape {
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events)) return emptyStore();
    const events = parsed.events.filter(
      (e): e is LinkedInDemoChannelEvent =>
        Boolean(e) &&
        typeof e === "object" &&
        typeof (e as LinkedInDemoChannelEvent).id === "string" &&
        typeof (e as LinkedInDemoChannelEvent).event_id === "string" &&
        typeof (e as LinkedInDemoChannelEvent).event_type === "string" &&
        typeof (e as LinkedInDemoChannelEvent).profile_url === "string" &&
        typeof (e as LinkedInDemoChannelEvent).occurred_at === "string",
    );
    return { version: 1, events };
  } catch {
    return emptyStore();
  }
}

function readStore(): StoreShape {
  if (!isBrowser()) return emptyStore();
  return parseStore(window.localStorage.getItem(LINKEDIN_DEMO_EVENTS_STORAGE_KEY));
}

function writeStore(store: StoreShape): void {
  if (!isBrowser()) return;
  const raw = JSON.stringify(store);
  window.localStorage.setItem(LINKEDIN_DEMO_EVENTS_STORAGE_KEY, raw);
  snapshotCacheRaw = raw;
  snapshotCache = store.events
    .slice()
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  window.dispatchEvent(new Event(LINKEDIN_DEMO_EVENTS_CHANGED));
}

export function listLinkedInDemoEvents(limit = 40): LinkedInDemoChannelEvent[] {
  const capped = Math.min(Math.max(Math.floor(limit), 1), MAX_EVENTS);
  return readStore()
    .events.slice()
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, capped);
}

export function buildLinkedInDemoEvent(input: {
  eventType: LinkedInEventType;
  profileUrl: string;
  body?: string;
  eventId?: string;
  seatId?: string;
}): LinkedInDemoChannelEvent {
  const now = new Date().toISOString();
  const eventId = input.eventId?.trim() || `sim:${input.eventType}:${newId()}`;
  const isReply = input.eventType === "reply";
  return {
    id: newId(),
    event_id: eventId,
    event_type: input.eventType,
    profile_url: input.profileUrl,
    body: typeof input.body === "string" ? input.body : "",
    candidate_id: null,
    inbound_id: isReply ? `demo-inbound:${eventId}` : null,
    conversation_id: null,
    occurred_at: now,
    created_at: now,
    payload: {
      source: "admin_simulate",
      demo: true,
      seatId: input.seatId ?? null,
    },
  };
}

/** Idempotent append by event_id. Returns { event, duplicate }. */
export function appendLinkedInDemoEvent(
  event: LinkedInDemoChannelEvent,
): { event: LinkedInDemoChannelEvent; duplicate: boolean } {
  const store = readStore();
  const existing = store.events.find((e) => e.event_id === event.event_id);
  if (existing) return { event: existing, duplicate: true };
  const next: StoreShape = {
    version: 1,
    events: [event, ...store.events].slice(0, MAX_EVENTS),
  };
  writeStore(next);
  return { event, duplicate: false };
}

export function clearLinkedInDemoEvents(): void {
  writeStore(emptyStore());
}

/** Subscribe for React useSyncExternalStore. */
export function subscribeLinkedInDemoEvents(onStoreChange: () => void): () => void {
  if (!isBrowser()) return () => undefined;
  const handler = () => onStoreChange();
  window.addEventListener(LINKEDIN_DEMO_EVENTS_CHANGED, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(LINKEDIN_DEMO_EVENTS_CHANGED, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Stable snapshot for useSyncExternalStore — same array ref until storage changes. */
export function getLinkedInDemoEventsSnapshot(): LinkedInDemoChannelEvent[] {
  if (!isBrowser()) return EMPTY_EVENTS;
  const raw = window.localStorage.getItem(LINKEDIN_DEMO_EVENTS_STORAGE_KEY);
  if (raw === snapshotCacheRaw) return snapshotCache;
  snapshotCacheRaw = raw;
  if (!raw) {
    snapshotCache = EMPTY_EVENTS;
    return snapshotCache;
  }
  snapshotCache = listLinkedInDemoEvents(MAX_EVENTS);
  return snapshotCache;
}
