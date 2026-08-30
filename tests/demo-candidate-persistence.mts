import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHistoricalDemoSeedState, buildSeedState } from "../src/lib/seed";
import { demoStateAllowsCandidatePersistence } from "../src/lib/store/demo-persistence";
import { loadState } from "../src/lib/store/migrations";
import type { Candidate, HermesState } from "../src/lib/types";

const storeSource = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");

function candidateWithProvenance(
  provenance: Candidate["provenance"],
): Candidate {
  const seed = buildHistoricalDemoSeedState().candidates[0];
  assert.ok(seed);
  return {
    ...seed,
    id: `candidate-${provenance ?? "missing"}`,
    name: `Candidate ${provenance ?? "missing"}`,
    provenance,
  };
}

test("demo persistence accepts only explicitly synthetic candidate records", () => {
  const seed = buildSeedState();
  assert.equal(demoStateAllowsCandidatePersistence(seed), true);

  for (const provenance of ["live", "manual", undefined] as const) {
    const unsafe: HermesState = {
      ...seed,
      candidates: [candidateWithProvenance(provenance), ...seed.candidates],
    };
    assert.equal(demoStateAllowsCandidatePersistence(unsafe), false, String(provenance));
  }
});

test("demo hydration purges a legacy localStorage snapshot containing real candidate PII", () => {
  const seed = buildSeedState();
  const polluted: HermesState = {
    ...seed,
    candidates: [candidateWithProvenance("live"), ...seed.candidates],
  };
  const values = new Map<string, string>([
    ["hermes-sourcing:v1", JSON.stringify(polluted)],
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
    assert.equal(loaded.candidates.some((candidate) => candidate.provenance === "live"), false);
    assert.deepEqual(removed, ["hermes-sourcing:v1"]);
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

test("the store enforces the synthetic-only predicate at commit and localStorage boundaries", () => {
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
