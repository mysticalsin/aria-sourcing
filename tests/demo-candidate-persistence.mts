import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSeedState } from "../src/lib/seed";
import { demoStateAllowsCandidatePersistence } from "../src/lib/store/demo-persistence";
import { loadState } from "../src/lib/store/migrations";
import type { Candidate, HermesState } from "../src/lib/types";

const storeSource = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");

function candidateWithProvenance(
  provenance: Candidate["provenance"],
): Candidate {
  const seed = buildSeedState().candidates[0];
  assert.ok(seed);
  return {
    ...seed,
    id: `candidate-${provenance ?? "missing"}`,
    name: `Candidate ${provenance ?? "missing"}`,
    provenance,
  };
}

test("demo persistence accepts synthetic and live candidate records", () => {
  const seed = buildSeedState();
  assert.equal(demoStateAllowsCandidatePersistence(seed), true);

  const withLive: HermesState = {
    ...seed,
    candidates: [candidateWithProvenance("live"), ...seed.candidates],
  };
  assert.equal(demoStateAllowsCandidatePersistence(withLive), true);

  for (const provenance of ["manual", undefined] as const) {
    const unsafe: HermesState = {
      ...seed,
      candidates: [candidateWithProvenance(provenance), ...seed.candidates],
    };
    assert.equal(demoStateAllowsCandidatePersistence(unsafe), false, String(provenance));
  }
});

test("demo hydration keeps LinkedIn/live profiles and purges unknown provenance", () => {
  const seed = buildSeedState();
  const liveOk: HermesState = {
    ...seed,
    candidates: [candidateWithProvenance("live"), ...seed.candidates],
  };
  const polluted: HermesState = {
    ...seed,
    candidates: [candidateWithProvenance(undefined), ...seed.candidates],
  };
  const values = new Map<string, string>([
    ["hermes-sourcing:v1", JSON.stringify(liveOk)],
  ]);
  const removed: string[] = [];
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => {
          removed.push(key);
          values.delete(key);
        },
      },
    },
  });
  try {
    const loaded = loadState();
    assert.equal(demoStateAllowsCandidatePersistence(loaded), true);
    assert.equal(loaded.candidates.some((candidate) => candidate.provenance === "live"), true);
    assert.deepEqual(removed, []);

    values.set("hermes-sourcing:v1", JSON.stringify(polluted));
    const purged = loadState();
    assert.equal(purged.candidates.some((c) => c.provenance === undefined), false);
    // Cast: assert.deepEqual(removed, []) above narrows removed to never[] under tsc.
    assert.ok((removed as string[]).includes("hermes-sourcing:v1"));
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test("the store enforces the demo persistence predicate at commit and localStorage boundaries", () => {
  const occurrences = storeSource.match(/demoStateAllowsCandidatePersistence\(/g) ?? [];
  assert.ok(occurrences.length >= 3);
  assert.match(
    storeSource,
    /const flushLocalSave[\s\S]*?demoStateAllowsCandidatePersistence\(pending\)[\s\S]*?localStorage\.setItem/,
  );
  assert.match(
    storeSource,
    /const commit = useCallback[\s\S]*?demoStateAllowsCandidatePersistence\(next\)[\s\S]*?setState\(next\)/,
  );
  assert.match(
    storeSource,
    /const commitPersisted = useCallback[\s\S]*?demoStateAllowsCandidatePersistence\(next\)[\s\S]*?if \(!supabaseEnabled\)/,
  );
});
