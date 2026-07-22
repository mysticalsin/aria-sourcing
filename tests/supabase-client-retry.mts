import { createEdgeResilientFetch } from "../src/lib/supabase/client.js";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error("FAIL:", name);
}

function response(status: number, cancel?: () => Promise<void>): Response {
  return {
    status,
    body: cancel ? { cancel } : null,
  } as unknown as Response;
}

const noWait = async () => {};

{
  let attempts = 0;
  let cancellations = 0;
  const resilientFetch = createEdgeResilientFetch({
    fetchImpl: (async () => {
      attempts += 1;
      return attempts === 1
        ? response(503, async () => { cancellations += 1; })
        : response(200);
    }) as typeof fetch,
    waitBeforeRetry: noWait,
  });

  const result = await resilientFetch("https://example.test/rest/v1/candidates");
  ok("GET retries a transient gateway response", result.status === 200 && attempts === 2);
  ok("GET cancels the discarded retryable response body", cancellations === 1);
}

{
  let attempts = 0;
  const transportError = new TypeError("connection dropped");
  const resilientFetch = createEdgeResilientFetch({
    fetchImpl: (async () => {
      attempts += 1;
      if (attempts === 1) throw transportError;
      return response(200);
    }) as typeof fetch,
    waitBeforeRetry: noWait,
  });

  const result = await resilientFetch("https://example.test/rest/v1/workspaces", { method: "GET" });
  ok("GET retries a transport failure", result.status === 200 && attempts === 2);
}

{
  let attempts = 0;
  let cancellations = 0;
  const rejected = response(503, async () => { cancellations += 1; });
  const resilientFetch = createEdgeResilientFetch({
    fetchImpl: (async () => {
      attempts += 1;
      return rejected;
    }) as typeof fetch,
    waitBeforeRetry: noWait,
  });

  const result = await resilientFetch("https://example.test/auth/v1/token", { method: "POST" });
  ok("POST returns the first gateway response without replay", result === rejected && attempts === 1);
  ok("POST response remains owned by the caller", cancellations === 0);
}

{
  let attempts = 0;
  const transportError = new TypeError("ambiguous POST outcome");
  const resilientFetch = createEdgeResilientFetch({
    fetchImpl: (async () => {
      attempts += 1;
      throw transportError;
    }) as typeof fetch,
    waitBeforeRetry: noWait,
  });

  let caught: unknown;
  try {
    await resilientFetch("https://example.test/auth/v1/token", { method: "POST" });
  } catch (error) {
    caught = error;
  }
  ok("POST transport failure is not replayed", caught === transportError && attempts === 1);
}

{
  let attempts = 0;
  const controller = new AbortController();
  const callerReason = new DOMException("caller stopped", "AbortError");
  const resilientFetch = createEdgeResilientFetch({
    fetchImpl: ((_, init) => {
      attempts += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch,
    waitBeforeRetry: noWait,
  });

  const pending = resilientFetch("https://example.test/rest/v1/candidates", { signal: controller.signal });
  controller.abort(callerReason);
  let caught: unknown;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  ok("caller abort stops the active attempt without retry", caught === callerReason && attempts === 1);
}

{
  let attempts = 0;
  let timersCreated = 0;
  let timersCleared = 0;
  let listenersAdded = 0;
  let listenersRemoved = 0;
  const externalSignal = {
    aborted: false,
    reason: undefined,
    addEventListener: () => { listenersAdded += 1; },
    removeEventListener: () => { listenersRemoved += 1; },
  } as unknown as AbortSignal;
  const resilientFetch = createEdgeResilientFetch({
    fetchImpl: (async () => {
      attempts += 1;
      return response(200);
    }) as typeof fetch,
    setAttemptTimeout: (() => {
      timersCreated += 1;
      return timersCreated as unknown as ReturnType<typeof setTimeout>;
    }),
    clearAttemptTimeout: (() => { timersCleared += 1; }),
    waitBeforeRetry: noWait,
  });

  await resilientFetch("https://example.test/rest/v1/candidates", { signal: externalSignal });
  ok("successful attempt clears its timeout", attempts === 1 && timersCreated === 1 && timersCleared === 1);
  ok("successful attempt removes its abort listener", listenersAdded === 1 && listenersRemoved === 1);
}

console.log(`RESULT supabase-client-retry: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
