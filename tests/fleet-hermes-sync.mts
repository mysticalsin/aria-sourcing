/* ==========================================================================
   tests/fleet-hermes-sync.mts
   Hermes ↔ fleet ownership patches — write owned + clear foreign.
   ========================================================================== */

import {
  fleetHermesComputerPatches,
  computerHealthOwnedBySeat,
  isStaleHermesComputerTwin,
  hermesPatchesFromBrowserSeatBindings,
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
  ok(
    "clears Hermes when only orphan-bound on fleet (no login-wall twin)",
    patches.some((p) => p.seatId === "seat_a" && p.computerId === null),
  );
}

{
  const patches = fleetHermesComputerPatches(
    [{ id: "seat_a", computerId: "comp_gone" }],
    [{ seatId: "seat_b", computerId: "comp_b" }],
  );
  ok(
    "clears Hermes when computerId absent from non-empty fleet",
    patches.some((p) => p.seatId === "seat_a" && p.computerId === null),
  );
}

{
  const patches = fleetHermesComputerPatches(
    [{ id: "seat_a", computerId: "comp_keep" }],
    [],
  );
  ok(
    "empty fleet poll does not clear Hermes (ambiguous / transient)",
    patches.length === 0,
  );
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

{
  ok(
    "empty fleet poll with Hermes id is fail-closed stale twin",
    isStaleHermesComputerTwin("seat_a", "comp_wall", []),
  );
  ok(
    "orphan fleet row is stale twin",
    isStaleHermesComputerTwin("seat_a", "comp_wall", [
      { seatId: "__orphan__", computerId: "comp_wall" },
    ]),
  );
  ok(
    "absent from non-empty fleet is stale twin",
    isStaleHermesComputerTwin("seat_a", "comp_gone", [
      { seatId: "seat_b", computerId: "comp_b" },
    ]),
  );
  ok(
    "foreign owner is stale twin",
    isStaleHermesComputerTwin("seat_a", "comp_b", [
      { seatId: "seat_b", computerId: "comp_b" },
    ]),
  );
  ok(
    "owned binding is not stale twin",
    !isStaleHermesComputerTwin("seat_a", "comp_a", [
      { seatId: "seat_a", computerId: "comp_a" },
    ]),
  );
  ok(
    "null hermes id is not stale twin",
    !isStaleHermesComputerTwin("seat_a", null, [
      { seatId: "__orphan__", computerId: "comp_x" },
    ]),
  );
}

{
  const seats = [
    {
      id: "seat_a",
      provider: "LinkedIn Browser Computer" as const,
      assignedCampaignIds: ["camp_old"],
      computerId: "comp_stale",
    },
    {
      id: "seat_mail",
      provider: "Gmail API" as const,
      assignedCampaignIds: ["camp_x"],
      computerId: null,
    },
  ];
  const patches = hermesPatchesFromBrowserSeatBindings(seats as never, [
    { id: "seat_a", assignedCampaignIds: ["camp_new"], computerId: "comp_new" },
    { id: "seat_mail", assignedCampaignIds: [], computerId: null },
    { id: "seat_missing", assignedCampaignIds: ["camp_z"], computerId: "c" },
  ]);
  ok(
    "browserSeatBindings patches BC attach + computerId",
    patches.length === 1 &&
      patches[0]!.seatId === "seat_a" &&
      patches[0]!.assignedCampaignIds?.[0] === "camp_new" &&
      patches[0]!.computerId === "comp_new",
  );
  ok(
    "browserSeatBindings empty assigned clears Hermes attach",
    hermesPatchesFromBrowserSeatBindings(seats as never, [
      { id: "seat_a", assignedCampaignIds: [], computerId: "comp_stale" },
    ])[0]?.assignedCampaignIds?.length === 0,
  );
  ok(
    "browserSeatBindings omitted → no patches",
    hermesPatchesFromBrowserSeatBindings(seats as never, undefined).length === 0,
  );
}

console.log(`fleet-hermes-sync: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
