/**
 * Align Hermes seat.computerId with fleet GET rows.
 * Writes owned non-orphan bindings; clears Hermes when computerId is owned by
 * another seat, only present as __orphan__, or absent from a non-empty fleet
 * poll (stale twin after reclaim). Poll paths stay GET-only — never mints.
 *
 * Also: durable agent_seats attach/computerId via browserSeatBindings (Floor/Fleet).
 * Missing local desks get fail-closed stubs so N agents appear on the 3D floor.
 */

import { isBrowserComputerSeat } from "@/lib/campaign-seat-attach";
import { defaultSendWindow } from "@/lib/fleet";
import { LINKEDIN_BROWSER_SEAT_DEFAULTS } from "@/lib/send-pacing";
import type { AgentSeat } from "@/lib/types";

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

export type BrowserSeatBinding = {
  id: string;
  name?: string;
  computerId?: string | null;
  status?: string;
  assignedCampaignIds?: string[];
};

export type HermesSeatAttachPatch = {
  seatId: string;
  assignedCampaignIds?: string[];
  computerId?: string | null;
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

/** Apply fleetHermesComputerPatches locally — never PATCH agent_seats from pollers. */
export function applyHermesComputerPatchesToSeats(
  seats: readonly AgentSeat[],
  patches: readonly HermesComputerPatch[],
): AgentSeat[] {
  if (!patches.length) return seats as AgentSeat[];
  const byId = new Map(patches.map((p) => [p.seatId, p.computerId] as const));
  let changed = false;
  const next = seats.map((seat) => {
    if (!byId.has(seat.id)) return seat;
    const computerId = byId.get(seat.id) ?? null;
    if ((seat.computerId ?? null) === computerId) return seat;
    changed = true;
    return { ...seat, computerId };
  });
  return changed ? next : (seats as AgentSeat[]);
}

/** Fail-closed Hermes stub for a durable LI desk missing from local roster. */
export function durableBrowserSeatStub(row: BrowserSeatBinding): AgentSeat {
  const status =
    row.status === "paused" || row.status === "disabled" || row.status === "active"
      ? row.status
      : "active";
  return {
    id: row.id,
    name: (row.name ?? "").trim() || row.id,
    operatorEmail: "",
    provider: "LinkedIn Browser Computer",
    status,
    // Never invent live+verified — Take→login→Release / probe must paint health.
    mode: "mock",
    domainVerified: false,
    dailyLimit: LINKEDIN_BROWSER_SEAT_DEFAULTS.dailyLimit,
    warmup: true,
    warmupStartCap: LINKEDIN_BROWSER_SEAT_DEFAULTS.warmupStartCap,
    warmupStepPerDay: LINKEDIN_BROWSER_SEAT_DEFAULTS.warmupStepPerDay,
    warmupStartedAt: new Date(0).toISOString(),
    minGapMinutes: LINKEDIN_BROWSER_SEAT_DEFAULTS.minGapMinutes,
    sendWindow: defaultSendWindow(),
    sentToday: 0,
    lastSendAt: null,
    health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: "",
    signature: "",
    connectedAccount: "",
    computerId: row.computerId ?? null,
    linkedinDeliveryBackend: "browser-computer",
    assignedCampaignIds: Array.isArray(row.assignedCampaignIds) ? row.assignedCampaignIds : [],
    createdAt: new Date(0).toISOString(),
  };
}

/**
 * Durable agent_seats bindings → Hermes attach/computerId patches.
 * Only patches seats that already exist locally (BC). Empty assigned is authority.
 */
export function hermesPatchesFromBrowserSeatBindings(
  seats: readonly AgentSeat[],
  bindings: readonly BrowserSeatBinding[] | undefined | null,
): HermesSeatAttachPatch[] {
  if (!Array.isArray(bindings)) return [];
  const out: HermesSeatAttachPatch[] = [];
  for (const row of bindings) {
    if (!row?.id) continue;
    const local = seats.find((s) => s.id === row.id);
    if (!local || !isBrowserComputerSeat(local)) continue;
    const patch: Omit<HermesSeatAttachPatch, "seatId"> = {};
    const durableAssigned = Array.isArray(row.assignedCampaignIds)
      ? row.assignedCampaignIds
      : [];
    const localAssigned = local.assignedCampaignIds ?? [];
    const sameAssign =
      durableAssigned.length === localAssigned.length &&
      durableAssigned.every((id: string) => localAssigned.includes(id));
    if (!sameAssign) patch.assignedCampaignIds = durableAssigned;
    if (row.computerId && row.computerId !== local.computerId) {
      patch.computerId = row.computerId;
    } else if (
      (row.computerId == null || String(row.computerId).trim() === "") &&
      Boolean((local.computerId ?? "").trim())
    ) {
      patch.computerId = null;
    }
    if (Object.keys(patch).length > 0) {
      out.push({ seatId: row.id, ...patch });
    }
  }
  return out;
}

/**
 * Apply durable bindings onto a seat list: append missing BC stubs, then patch.
 * Pure — store commits the result (no server write; DB already owns these rows).
 */
export function applyBrowserSeatBindingsToHermes(
  seats: readonly AgentSeat[],
  bindings: readonly BrowserSeatBinding[] | undefined | null,
): AgentSeat[] {
  if (!Array.isArray(bindings)) return seats.slice();
  const byId = new Set(seats.map((s) => s.id));
  const stubs: AgentSeat[] = [];
  for (const row of bindings) {
    if (!row?.id || byId.has(row.id)) continue;
    stubs.push(durableBrowserSeatStub(row));
  }
  let next: AgentSeat[] = stubs.length > 0 ? [...seats, ...stubs] : seats.slice();
  for (const patch of hermesPatchesFromBrowserSeatBindings(next, bindings)) {
    const { seatId, ...rest } = patch;
    next = next.map((s) => (s.id === seatId ? { ...s, ...rest } : s));
  }
  return next;
}

/**
 * True when Hermes computerId must not be fed into Deploy/reclaim as
 * existingComputerId — fleet shows orphan, absent, or foreign owner.
 * Empty fleet poll with a Hermes id is fail-closed stale (cannot prove ownership).
 */
export function isStaleHermesComputerTwin(
  seatId: string,
  hermesComputerId: string | null | undefined,
  computers: readonly FleetComputerBinding[],
): boolean {
  const hermesId = typeof hermesComputerId === "string" ? hermesComputerId.trim() : "";
  if (!hermesId) return false;
  // Empty poll cannot prove the twin is ours — omit existingComputerId (fail closed).
  if (computers.length === 0) return true;
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
