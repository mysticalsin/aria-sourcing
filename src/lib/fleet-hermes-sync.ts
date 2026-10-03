/**
 * Align Hermes seat.computerId with fleet GET rows.
 * Writes owned non-orphan bindings; clears Hermes when computerId is owned by
 * another seat, only present as __orphan__, or absent from a non-empty fleet
 * poll (stale twin after reclaim). Poll paths stay GET-only — never mints.
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

/** Patches to apply so Hermes matches fleet ownership (write + clear-foreign/orphan). */
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
      continue;
    }
    // No seat-owned fleet row for this Hermes id. Empty fleet poll is ambiguous
    // (transient) — fail soft. Non-empty poll means orphan-only or absent → clear
    // so Deploy cannot feed a login-wall twin into reclaim/ensure.
    if (computers.length > 0 && !owner) {
      patches.push({ seatId: seat.id, computerId: null });
    }
  }
  return patches;
}

/**
 * True when Hermes computerId must not be fed into Deploy/reclaim as
 * existingComputerId — fleet shows orphan, absent, or foreign owner.
 * Empty fleet poll is ambiguous (not stale).
 */
export function isStaleHermesComputerTwin(
  seatId: string,
  hermesComputerId: string | null | undefined,
  computers: readonly FleetComputerBinding[],
): boolean {
  const hermesId = typeof hermesComputerId === "string" ? hermesComputerId.trim() : "";
  if (!hermesId || computers.length === 0) return false;
  const fleetRow = computers.find((c) => {
    const id = typeof c.computerId === "string" ? c.computerId.trim() : "";
    return id === hermesId;
  });
  if (!fleetRow) return true;
  const owner = typeof fleetRow.seatId === "string" ? fleetRow.seatId.trim() : "";
  if (!owner || owner === ORPHAN) return true;
  return owner !== seatId;
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
    // Orphan / empty owner must not paint every desk green — only the owning seat.
    if (!owner || owner === ORPHAN) return false;
    return owner === seatId;
  }
  // Not on fleet list — fail closed. Never green-badge a desk for a stale /
  // unbound computerId that fleet does not currently expose.
  return false;
}
