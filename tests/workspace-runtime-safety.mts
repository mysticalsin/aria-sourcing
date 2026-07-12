import { readFileSync } from "node:fs";
import type { WorkspaceStatus } from "../src/lib/workspace-status.ts";

const runtime = await import("../src/lib/workspace-status.ts") as Record<string, unknown>;
const settleWorkspaceSave = runtime.settleWorkspaceSave as undefined | ((input: Record<string, unknown>) => Promise<string>);
const runWorkspaceEffect = runtime.runWorkspaceEffect as
  | undefined
  | (<T>(status: WorkspaceStatus, effect: () => T) => { allowed: true; value: T } | { allowed: false; reason: string });
const retainPendingWorkspaceSave = runtime.retainPendingWorkspaceSave as
  | undefined
  | (<T>(
      pending: { workspaceId: string; snapshot: T; expectedUpdatedAt: string | null; generation: number },
      newestSnapshot: T | null,
      expectedUpdatedAt: string | null,
    ) => { workspaceId: string; snapshot: T; expectedUpdatedAt: string | null; generation: number });

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const unavailable: WorkspaceStatus = {
  phase: "unavailable",
  mode: "live",
  dependency: "state",
  message: "Unavailable",
};
const ready: WorkspaceStatus = { phase: "ready", mode: "live" };

let effectCalls = 0;
const blockedAttempt = runWorkspaceEffect?.(unavailable, () => {
  effectCalls += 1;
  return "called";
});
ok(
  "unavailable preflight does not invoke an effect",
  blockedAttempt?.allowed === false && effectCalls === 0,
);

let status: WorkspaceStatus = ready;
const earlyAttempt = runWorkspaceEffect?.(status, () => "early-ok");
status = unavailable;
const dispatchAttempt = runWorkspaceEffect?.(status, () => {
  effectCalls += 1;
  return "dispatched";
});
ok(
  "dispatch-time preflight blocks an effect when availability changes after action start",
  earlyAttempt?.allowed === true && dispatchAttempt?.allowed === false && effectCalls === 0,
);

const allowedAttempt = runWorkspaceEffect?.(ready, () => {
  effectCalls += 1;
  return "allowed";
});
ok(
  "ready preflight invokes the effect exactly once",
  allowedAttempt?.allowed === true && allowedAttempt.value === "allowed" && effectCalls === 1,
);

const attemptedSnapshot = { id: "attempted" };
const newestSnapshot = { id: "newest" };
const retained = retainPendingWorkspaceSave?.(
  {
    workspaceId: "workspace-1",
    snapshot: attemptedSnapshot,
    expectedUpdatedAt: "version-1",
    generation: 4,
  },
  newestSnapshot,
  "version-1",
);
ok(
  "retryable failure retains the newest queued snapshot and its generation",
  retained?.snapshot === newestSnapshot && retained.generation === 4 && retained.expectedUpdatedAt === "version-1",
);

let generation = 1;
let savedApplies = 0;
let conflictApplies = 0;

const unavailableSeatsOutcome = settleWorkspaceSave
  ? await settleWorkspaceSave({
      generation,
      currentGeneration: () => generation,
      save: async () => ({ ok: false, conflict: true, latest: { state: { id: "team" }, updatedAt: "version-2" } }),
      prepareConflict: async () => null,
      applySaved: () => {
        savedApplies += 1;
      },
      applyConflict: () => {
        conflictApplies += 1;
      },
    })
  : undefined;
ok(
  "conflict with unavailable authoritative seats remains retryable",
  unavailableSeatsOutcome === "failed" && savedApplies === 0 && conflictApplies === 0,
);

const throwingSeatsOutcome = settleWorkspaceSave
  ? await settleWorkspaceSave({
      generation,
      currentGeneration: () => generation,
      save: async () => ({ ok: false, conflict: true, latest: { state: { id: "team" }, updatedAt: "version-2" } }),
      prepareConflict: async () => {
        throw new Error("agent seats unavailable");
      },
      applySaved: () => {
        savedApplies += 1;
      },
      applyConflict: () => {
        conflictApplies += 1;
      },
    })
  : undefined;
ok(
  "conflict with throwing authoritative-seat reload remains retryable",
  throwingSeatsOutcome === "failed" && savedApplies === 0 && conflictApplies === 0,
);

const preparedConflict = { state: { id: "team" }, updatedAt: "version-2" };
const reconciledOutcome = settleWorkspaceSave
  ? await settleWorkspaceSave({
      generation,
      currentGeneration: () => generation,
      save: async () => ({ ok: false, conflict: true, latest: preparedConflict }),
      prepareConflict: async () => preparedConflict,
      applySaved: () => {
        savedApplies += 1;
      },
      applyConflict: () => {
        conflictApplies += 1;
      },
    })
  : undefined;
ok(
  "fully prepared current conflict reconciles exactly once",
  reconciledOutcome === "conflict" && conflictApplies === 1,
);

const delayedSave = deferred<{ ok: true; updatedAt: string }>();
generation = 7;
const staleSave = settleWorkspaceSave?.({
  generation,
  currentGeneration: () => generation,
  save: () => delayedSave.promise,
  prepareConflict: async () => null,
  applySaved: () => {
    savedApplies += 1;
  },
  applyConflict: () => {
    conflictApplies += 1;
  },
});
generation = 8;
delayedSave.resolve({ ok: true, updatedAt: "stale-version" });
const staleSaveOutcome = await staleSave;
ok(
  "stale save completion cannot apply a token or ready state after a newer hydrate",
  staleSaveOutcome === "stale" && savedApplies === 0,
);

const delayedPreparation = deferred<{ state: { id: string }; updatedAt: string }>();
generation = 10;
const staleConflict = settleWorkspaceSave?.({
  generation,
  currentGeneration: () => generation,
  save: async () => ({ ok: false, conflict: true, latest: { state: { id: "team" }, updatedAt: "version-10" } }),
  prepareConflict: () => delayedPreparation.promise,
  applySaved: () => {
    savedApplies += 1;
  },
  applyConflict: () => {
    conflictApplies += 1;
  },
});
await Promise.resolve();
generation = 11;
delayedPreparation.resolve({ state: { id: "team" }, updatedAt: "version-10" });
const staleConflictOutcome = await staleConflict;
ok(
  "stale conflict preparation cannot apply state after a newer hydrate",
  staleConflictOutcome === "stale" && conflictApplies === 1,
);

const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const hydrateStart = store.indexOf("const hydrateWorkspace = useCallback");
const persistStart = store.indexOf("const persistPendingSave = useCallback", hydrateStart);
const hydrateWiring = hydrateStart >= 0 && persistStart > hydrateStart
  ? store.slice(hydrateStart, persistStart)
  : "";
ok(
  "hydration invalidates the active save operation and clears stale queued work",
  /\+\+hydrationGeneration\.current/.test(hydrateWiring) &&
    /queuedRemoteSnapshot\.current = null/.test(hydrateWiring) &&
    /pendingRemoteSave\.current = null/.test(hydrateWiring) &&
    /remoteSaveOperation\.current = null/.test(hydrateWiring) &&
    /remoteSaveInFlight\.current = false/.test(hydrateWiring),
);
ok(
  "the store coordinator passes save generation through the settlement boundary",
  /settleWorkspaceSave\(\{\s*generation: pending\.generation,\s*currentGeneration: \(\) => hydrationGeneration\.current/.test(store) &&
    /expectedUpdatedAt: remoteUpdatedAtRef\.current,\s*generation: hydrationGeneration\.current/.test(store),
);
ok(
  "stale save callbacks are operation-token guarded before mutating coordinator state",
  (store.match(/remoteSaveOperation\.current !== operation/g) ?? []).length >= 3 &&
    /remoteSaveOperation\.current === operation[\s\S]{0,180}remoteSaveInFlight\.current = false/.test(store),
);
ok(
  "failed save wiring retains the newest queued snapshot before clearing the queue",
  (store.match(/const newestSnapshot = queuedRemoteSnapshot\.current \?\? pending\.snapshot;\s*queuedRemoteSnapshot\.current = null;\s*markRemoteSaveFailed\(pending, newestSnapshot\)/g) ?? []).length >= 2,
);

console.log(`RESULT workspace-runtime-safety: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
