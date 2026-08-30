import {
  appendLinkedInDemoEvent,
  buildLinkedInDemoEvent,
  clearLinkedInDemoEvents,
  getLinkedInDemoEventsSnapshot,
  listLinkedInDemoEvents,
  LINKEDIN_DEMO_EVENTS_STORAGE_KEY,
} from "../src/lib/linkedin-demo-events-store";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

const memory = new MemoryStorage();
const listeners = new Map<string, Set<() => void>>();
(globalThis as { window?: unknown }).window = {
  localStorage: memory,
  addEventListener(type: string, handler: () => void) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(handler);
  },
  removeEventListener(type: string, handler: () => void) {
    listeners.get(type)?.delete(handler);
  },
  dispatchEvent(event: { type: string }) {
    for (const handler of listeners.get(event.type) ?? []) handler();
    return true;
  },
};

clearLinkedInDemoEvents();

const first = buildLinkedInDemoEvent({
  eventType: "reply",
  profileUrl: "https://www.linkedin.com/in/demo-candidate",
  body: "Interested — let's talk.",
  eventId: "sim:reply:fixed-1",
});

ok("demo reply has inbound id", typeof first.inbound_id === "string" && first.inbound_id.length > 0);
ok("demo reply body preserved", first.body.includes("Interested"));

const written = appendLinkedInDemoEvent(first);
ok("first append not duplicate", written.duplicate === false);
ok("store lists one event", listLinkedInDemoEvents().length === 1);
ok("localStorage key written", memory.getItem(LINKEDIN_DEMO_EVENTS_STORAGE_KEY)?.includes("sim:reply:fixed-1") === true);

const again = appendLinkedInDemoEvent(first);
ok("second append is idempotent", again.duplicate === true);
ok("store still one event", listLinkedInDemoEvents().length === 1);

const lifecycle = buildLinkedInDemoEvent({
  eventType: "connection_accepted",
  profileUrl: "https://www.linkedin.com/in/demo-candidate",
  eventId: "sim:accept:fixed-2",
});
ok("lifecycle has no inbound", lifecycle.inbound_id === null);
appendLinkedInDemoEvent(lifecycle);
ok("store lists two events", listLinkedInDemoEvents().length === 2);

const listed = listLinkedInDemoEvents(1);
ok("limit caps list", listed.length === 1);

clearLinkedInDemoEvents();
ok("clear empties store", listLinkedInDemoEvents().length === 0);

const snapA = getLinkedInDemoEventsSnapshot();
const snapB = getLinkedInDemoEventsSnapshot();
ok("empty snapshot is stable", snapA === snapB);

appendLinkedInDemoEvent(
  buildLinkedInDemoEvent({
    eventType: "reply",
    profileUrl: "https://www.linkedin.com/in/stable",
    body: "stable",
    eventId: "sim:reply:stable",
  }),
);
const snapC = getLinkedInDemoEventsSnapshot();
const snapD = getLinkedInDemoEventsSnapshot();
ok("filled snapshot is stable", snapC === snapD && snapC.length === 1);

console.log(`RESULT linkedin-demo-events-store: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
