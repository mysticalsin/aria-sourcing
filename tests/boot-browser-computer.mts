/* ==========================================================================
   tests/boot-browser-computer.mts
   resolveDurableComputerId — reclaim-before-mint client contract.
   ========================================================================== */

import { resolveDurableComputerId } from "../src/lib/boot-browser-computer";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const originalFetch = globalThis.fetch;

try {
  // Healthy reclaim wins over a blank existing mint.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        sessionHealthy: true,
        computer: { computerId: "comp_durable_orphan", sessionHealthy: true },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const reclaimed = await resolveDurableComputerId({
    seatId: "seat_1",
    existingComputerId: "comp_blank_mint",
  });
  ok("reclaim returns probed-healthy orphan id", reclaimed === "comp_durable_orphan");

  // Unhealthy / empty reclaim keeps existing when present.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        sessionHealthy: false,
        computer: { computerId: "comp_blank_mint", sessionHealthy: false },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const kept = await resolveDurableComputerId({
    seatId: "seat_1",
    existingComputerId: "comp_blank_mint",
  });
  ok("unhealthy reclaim keeps existing computerId", kept === "comp_blank_mint");

  // No existing + failed reclaim mints a fresh id (never invents healthy).
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "no-healthy-orphan" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  const minted = await resolveDurableComputerId({ seatId: "seat_2" });
  ok("mint when no orphan", minted.startsWith("comp_") && minted.length > 10);
  ok("mint does not invent durable orphan id", minted !== "comp_durable_orphan");

  // Never invent sessionHealthy=true from a non-healthy payload with an id.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        sessionHealthy: null,
        computer: { computerId: "comp_unverified", sessionHealthy: null },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const unverified = await resolveDurableComputerId({
    seatId: "seat_3",
    existingComputerId: "comp_existing",
  });
  ok(
    "null sessionHealthy does not adopt orphan as durable",
    unverified === "comp_existing",
  );

  // Posts reclaim_healthy_orphan with seatId (+ computerId when present).
  let posted: unknown = null;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    posted = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        sessionHealthy: true,
        computer: { computerId: "comp_ok", sessionHealthy: true },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  await resolveDurableComputerId({
    seatId: "seat_post",
    existingComputerId: "comp_prev",
  });
  const body = posted as { action?: string; seatId?: string; computerId?: string };
  ok("posts reclaim_healthy_orphan", body.action === "reclaim_healthy_orphan");
  ok("posts seatId", body.seatId === "seat_post");
  ok("posts existing computerId for probe", body.computerId === "comp_prev");
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`boot-browser-computer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
