/**
 * memory-soul.mts — pure state-transform tests for Memory + Soul features.
 * No browser DOM required; tests apply the same logic the store actions use.
 */

import { buildSeedState, defaultSettings, STATE_VERSION } from "../src/lib/seed.ts";
import { migrateToCurrentVersion } from "../src/lib/store.ts";
import type { HermesState, MemoryEntry, MemoryKind } from "../src/lib/types.ts";
import { MEMORY_KINDS } from "../src/lib/types.ts";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- helpers mirroring store commit logic -------------------------------- */

function genId(prefix: string): string {
  return `${prefix}_test_${Math.random().toString(36).slice(2, 8)}`;
}

function addMemoryToState(
  s: HermesState,
  seatId: string,
  kind: MemoryKind,
  content: string,
): { state: HermesState; entry: MemoryEntry } {
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: genId("mem"),
    seatId,
    kind,
    content: content.trim(),
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...s, memory: [entry, ...s.memory] }, entry };
}

function updateMemoryInState(
  s: HermesState,
  id: string,
  patch: Partial<Pick<MemoryEntry, "kind" | "content" | "pinned">>,
): HermesState {
  return {
    ...s,
    memory: s.memory.map((m) =>
      m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m,
    ),
  };
}

function removeMemoryFromState(s: HermesState, id: string): HermesState {
  return { ...s, memory: s.memory.filter((m) => m.id !== id) };
}

function togglePinInState(s: HermesState, id: string): HermesState {
  return {
    ...s,
    memory: s.memory.map((m) =>
      m.id === id ? { ...m, pinned: !m.pinned, updatedAt: new Date().toISOString() } : m,
    ),
  };
}

/* ---- seed state baseline ------------------------------------------------- */

const seed = buildSeedState();

ok("STATE_VERSION is a positive integer", Number.isInteger(STATE_VERSION) && STATE_VERSION > 0);
ok("seed version matches STATE_VERSION", seed.version === STATE_VERSION);
ok("seed state has memory array", Array.isArray(seed.memory));
ok("seed memory starts empty", seed.memory.length === 0);
ok("defaultSettings has memoryCapacity", (defaultSettings().memoryCapacity ?? 0) > 0);
ok("memoryCapacity default is 200", defaultSettings().memoryCapacity === 200);

/* ---- MEMORY_KINDS constant ----------------------------------------------- */

ok("MEMORY_KINDS has 4 kinds", MEMORY_KINDS.length === 4);
ok("MEMORY_KINDS includes fact", (MEMORY_KINDS as readonly string[]).includes("fact"));
ok("MEMORY_KINDS includes preference", (MEMORY_KINDS as readonly string[]).includes("preference"));
ok("MEMORY_KINDS includes instruction", (MEMORY_KINDS as readonly string[]).includes("instruction"));
ok("MEMORY_KINDS includes episodic", (MEMORY_KINDS as readonly string[]).includes("episodic"));

/* ---- addMemory ----------------------------------------------------------- */

const { state: s1, entry: e1 } = addMemoryToState(seed, "seat_maya", "fact", "  Prefers async comms  ");
ok("addMemory trims content", e1.content === "Prefers async comms");
ok("addMemory sets pinned false", e1.pinned === false);
ok("addMemory seatId correct", e1.seatId === "seat_maya");
ok("addMemory kind correct", e1.kind === "fact");
ok("addMemory adds to state", s1.memory.length === 1);
ok("addMemory id is set", e1.id.startsWith("mem_"));

const { state: s2, entry: e2 } = addMemoryToState(s1, "seat_diego", "preference", "Writes in French");
ok("second addMemory stacks", s2.memory.length === 2);
ok("addMemory prepends (newest first)", s2.memory[0].id === e2.id);

/* ---- updateMemory -------------------------------------------------------- */

const s3 = updateMemoryInState(s2, e1.id, { content: "Prefers async, no calls", kind: "instruction" });
const updated = s3.memory.find((m) => m.id === e1.id);
ok("updateMemory patches content", updated?.content === "Prefers async, no calls");
ok("updateMemory patches kind", updated?.kind === "instruction");
ok("updateMemory updates updatedAt", typeof updated?.updatedAt === "string");
ok("updateMemory does not affect other entries", s3.memory.find((m) => m.id === e2.id)?.content === "Writes in French");

/* ---- removeMemory -------------------------------------------------------- */

const s4 = removeMemoryFromState(s3, e1.id);
ok("removeMemory removes entry", s4.memory.length === 1);
ok("removeMemory removes correct entry", !s4.memory.find((m) => m.id === e1.id));
ok("removeMemory leaves other entries", s4.memory[0].id === e2.id);

/* ---- togglePinMemory ----------------------------------------------------- */

const s5 = togglePinInState(s2, e1.id);
ok("togglePinMemory sets pinned true", s5.memory.find((m) => m.id === e1.id)?.pinned === true);

const s6 = togglePinInState(s5, e1.id);
ok("togglePinMemory toggles back to false", s6.memory.find((m) => m.id === e1.id)?.pinned === false);

/* ---- migration fill ------------------------------------------------------ */

// Simulate a state object from STATE_VERSION 9 (missing the memory field).
const legacyState = { ...seed, version: 9, memory: undefined } as unknown as HermesState;
const migrated = migrateToCurrentVersion(legacyState);
ok("migration fills missing memory array", Array.isArray(migrated.memory));
ok("migration fills memory as empty array", migrated.memory.length === 0);
ok("migration bumps version to current", migrated.version === STATE_VERSION);

// State that already has memory should keep it.
const withMemory = { ...seed, version: 9, memory: [{ id: "mem_x", seatId: "seat_maya", kind: "fact" as MemoryKind, content: "test", pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } as HermesState;
const migratedWithMemory = migrateToCurrentVersion(withMemory);
ok("migration preserves existing memory entries", migratedWithMemory.memory.length === 1);

/* ---- persona update ------------------------------------------------------ */

// Simulate updateSeat on the first seed seat.
const firstSeat = seed.seats[0];
ok("seed has seats", seed.seats.length > 0);

if (firstSeat) {
  const newPersona = "Technical, data-driven, brief. Lead with GitHub metrics.";
  const seatUpdated: HermesState = {
    ...seed,
    seats: seed.seats.map((x) =>
      x.id === firstSeat.id ? { ...x, persona: newPersona } : x,
    ),
  };
  ok("updateSeat changes persona", seatUpdated.seats.find((x) => x.id === firstSeat.id)?.persona === newPersona);
  ok("updateSeat does not affect other seats", seatUpdated.seats.filter((x) => x.id !== firstSeat.id).every((x) => x.persona === firstSeat.persona));
}

/* ---- memoryCapacity setting ---------------------------------------------- */

const settingsWithCap = { ...defaultSettings(), memoryCapacity: 500 };
ok("memoryCapacity can be overridden", settingsWithCap.memoryCapacity === 500);

/* ---- filter by seatId (simulates useMemory hook) ------------------------- */

const { state: sF } = addMemoryToState(seed, "seat_maya", "fact", "Maya fact");
const { state: sF2 } = addMemoryToState(sF, "seat_diego", "preference", "Diego pref");
const { state: sF3 } = addMemoryToState(sF2, "seat_maya", "episodic", "Maya episodic");

const mayaOnly = sF3.memory.filter((m) => m.seatId === "seat_maya");
const diegoOnly = sF3.memory.filter((m) => m.seatId === "seat_diego");
ok("useMemory(seatId) filters to one seat (maya)", mayaOnly.length === 2);
ok("useMemory(seatId) filters to one seat (diego)", diegoOnly.length === 1);
ok("useMemory() (no seatId) returns all", sF3.memory.length === 3);

/* ---- result --------------------------------------------------------------- */

console.log(`RESULT memory-soul: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
