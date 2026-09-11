/* ==========================================================================
   tests/fleet-hermes-sync.mts
   Hermes ↔ fleet ownership patches — write owned + clear foreign.
   ========================================================================== */

import {
  fleetHermesComputerPatches,
  computerHealthOwnedBySeat,
} from "../src/lib/fleet-hermes-sync";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

{
  const patches = fleetHermesComputerPatches(
    [
      { id: "seat_a", computerId: null },
      { id: "seat_b", computerId: "comp_stale" },
    ],
    [
      { seatId: "seat_a", computerId: "comp_a" },
      { seatId: "seat_b", computerId: "comp_b" },
    ],
  );
  ok(
    "writes owned binding onto null Hermes",
    patches.some((p) => p.seatId === "seat_a" && p.computerId === "comp_a"),
  );
  ok(
    "rewrites stale Hermes to owned binding",
    patches.some((p) => p.seatId === "seat_b" && p.computerId === "comp_b"),
  );
}

{
  const patches = fleetHermesComputerPatches(
    [
      { id: "seat_a", computerId: "comp_b" },
      { id: "seat_b", computerId: "comp_b" },
    ],
    [{ seatId: "seat_b", computerId: "comp_b" }],
  );
  ok(
    "clears Hermes when computerId owned by another seat",
    patches.some((p) => p.seatId === "seat_a" && p.computerId === null),
  );
  ok(
    "does not clear the true owner",
    !patches.some((p) => p.seatId === "seat_b" && p.computerId === null),
  );
}

{
  const patches = fleetHermesComputerPatches(
    [{ id: "seat_a", computerId: "comp_orphan" }],
    [{ seatId: "__orphan__", computerId: "comp_orphan" }],
  );
  ok("keeps Hermes when only orphan-bound on fleet", patches.length === 0);
}

{
  ok(
    "health blocked for orphan VM (no cross-desk green)",
    !computerHealthOwnedBySeat("seat_a", "comp_x", [
      { seatId: "__orphan__", computerId: "comp_x" },
    ]),
  );
  ok(
    "health allowed for own seat",
    computerHealthOwnedBySeat("seat_a", "comp_a", [
      { seatId: "seat_a", computerId: "comp_a" },
    ]),
  );
  ok(
    "health blocked for foreign seat",
    !computerHealthOwnedBySeat("seat_a", "comp_b", [
      { seatId: "seat_b", computerId: "comp_b" },
    ]),
  );
}


{
  ok(
    "health blocked when computerId absent from fleet",
    !computerHealthOwnedBySeat("seat_a", "comp_missing", [
      { seatId: "seat_b", computerId: "comp_b" },
    ]),
  );
  ok(
    "health blocked on empty fleet list",
    !computerHealthOwnedBySeat("seat_a", "comp_x", []),
  );
}

console.log(`fleet-hermes-sync: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
