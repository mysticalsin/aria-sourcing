/**
 * Align Hermes seat.computerId with fleet GET rows.
 * Writes owned non-orphan bindings; clears Hermes when computerId is owned by another seat.
 * Poll paths stay GET-only — this never mints or ensures.
 */

export type FleetComputerBinding = {
  seatId?: string | null;
  computerId?: string | null;
};

export type HermesSeatBinding = {
  id: string;
  computerId?: string | null;
};

export type HermesComputerPatch = {
  seatId: string;
  computerId: string | null;
};

const ORPHAN = "__orphan__";

/** Patches to apply so Hermes matches fleet ownership (write + clear-foreign). */
export function fleetHermesComputerPatches(
  seats: readonly HermesSeatBinding[],
  computers: readonly FleetComputerBinding[],
): HermesComputerPatch[] {
  const ownedBySeat = new Map<string, string>();
  const ownerOfComp = new Map<string, string>();
  for (const c of computers) {
    const seatId = typeof c.seatId === "string" ? c.seatId.trim() : "";
    const computerId = typeof c.computerId === "string" ? c.computerId.trim() : "";
    if (!computerId || !seatId || seatId === ORPHAN) continue;
    ownedBySeat.set(seatId, computerId);
    ownerOfComp.set(computerId, seatId);
  }

  const patches: HermesComputerPatch[] = [];
  for (const seat of seats) {
    const owned = ownedBySeat.get(seat.id);
    if (owned) {
      if (seat.computerId !== owned) {
        patches.push({ seatId: seat.id, computerId: owned });
      }
      continue;
    }
    const hermes = typeof seat.computerId === "string" ? seat.computerId.trim() : "";
    if (!hermes) continue;
    const owner = ownerOfComp.get(hermes);
    if (owner && owner !== seat.id) {
      patches.push({ seatId: seat.id, computerId: null });
    }
  }
  return patches;
}

/** True when a computerId health badge may apply to this seat (no cross-desk bleed). */
export function computerHealthOwnedBySeat(
  seatId: string,
  computerId: string,
  computers: readonly FleetComputerBinding[],
): boolean {
  const id = computerId.trim();
  if (!id) return false;
  for (const c of computers) {
    if (c.computerId !== id) continue;
    const owner = typeof c.seatId === "string" ? c.seatId.trim() : "";
    if (!owner || owner === ORPHAN || owner === seatId) return true;
    return false;
  }
  // Not on fleet list — treat as unbound; caller may still show null health.
  return true;
}
