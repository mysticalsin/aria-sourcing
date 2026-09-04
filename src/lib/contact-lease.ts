/**
 * Shared contact lease — sole authority for who may contact whom across the fleet.
 * Graphify / wiki knowledge must never grant a claim; only this ledger does.
 *
 * Postgres RPCs (migration 0063) are the durable authority. This module provides:
 *  - identity normalization
 *  - an in-memory lease manager mirroring SKIP LOCKED exclusivity (chaos tests)
 *  - thin helpers for the computer supervisor / dispatcher to call the same contract
 */

export const CONTACT_LEASE_STATES = [
  "available",
  "leased",
  "in_flight",
  "sent",
  "failed",
  "released",
  "suppressed",
] as const;
export type ContactLeaseState = (typeof CONTACT_LEASE_STATES)[number];

export type ContactIdentity = {
  candidateId: string;
  linkedinUrl?: string | null;
  email?: string | null;
  linkedinSub?: string | null;
};

export type ContactLease = {
  id: string;
  workspaceId: string;
  candidateId: string;
  identityKey: string;
  seatId: string;
  state: ContactLeaseState;
  leasedAt: number;
  expiresAt: number;
  computerJobId?: string | null;
};

export type ClaimContactInput = {
  workspaceId: string;
  candidate: ContactIdentity;
  seatId: string;
  ttlMs?: number;
  now?: number;
};

export type ClaimContactResult =
  | { ok: true; lease: ContactLease }
  | { ok: false; reason: string; holderSeatId?: string };

const DEFAULT_TTL_MS = 15 * 60_000;

/** Stable identity key: prefer linkedin_sub → normalized LI URL → email → candidateId. */
export function normalizeContactIdentityKey(candidate: ContactIdentity): string {
  const sub = (candidate.linkedinSub ?? "").trim().toLowerCase();
  if (sub) return `sub:${sub}`;

  const li = (candidate.linkedinUrl ?? "").trim().toLowerCase();
  if (li) {
    const m = li.match(/linkedin\.com\/(in|pub)\/([^/?#]+)/i);
    if (m?.[2]) return `li:${m[1]!.toLowerCase()}/${m[2].toLowerCase()}`;
    return `li:${li.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  const email = (candidate.email ?? "").trim().toLowerCase();
  if (email) return `email:${email}`;

  return `cand:${candidate.candidateId.trim()}`;
}

function newId(): string {
  return `lease_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * In-memory lease store with atomic claim semantics (one winner under concurrency).
 * Used for chaos exclusivity tests and local supervisor dry-runs.
 */
export class InMemoryContactLeaseStore {
  private readonly byKey = new Map<string, ContactLease>();
  private readonly lock = new Map<string, Promise<void>>();

  private async withKeyLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.lock.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.lock.set(
      key,
      prev.then(() => gate),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.lock.get(key) === gate) this.lock.delete(key);
    }
  }

  async claim(input: ClaimContactInput): Promise<ClaimContactResult> {
    const now = input.now ?? Date.now();
    const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
    const identityKey = normalizeContactIdentityKey(input.candidate);
    const mapKey = `${input.workspaceId}::${identityKey}`;

    return this.withKeyLock(mapKey, () => {
      const existing = this.byKey.get(mapKey);
      if (existing) {
        if (
          (existing.state === "leased" || existing.state === "in_flight" || existing.state === "sent") &&
          existing.expiresAt > now
        ) {
          return {
            ok: false as const,
            reason: existing.state === "sent" ? "already-sent" : "lease-held",
            holderSeatId: existing.seatId,
          };
        }
        if (existing.state === "suppressed") {
          return { ok: false as const, reason: "suppressed", holderSeatId: existing.seatId };
        }
      }

      const lease: ContactLease = {
        id: existing?.id ?? newId(),
        workspaceId: input.workspaceId,
        candidateId: input.candidate.candidateId,
        identityKey,
        seatId: input.seatId,
        state: "leased",
        leasedAt: now,
        expiresAt: now + ttl,
        computerJobId: null,
      };
      this.byKey.set(mapKey, lease);
      return { ok: true as const, lease };
    });
  }

  async markInFlight(workspaceId: string, identityKey: string, seatId: string, jobId: string): Promise<boolean> {
    const mapKey = `${workspaceId}::${identityKey}`;
    return this.withKeyLock(mapKey, () => {
      const lease = this.byKey.get(mapKey);
      if (!lease || lease.seatId !== seatId || lease.state !== "leased") return false;
      lease.state = "in_flight";
      lease.computerJobId = jobId;
      this.byKey.set(mapKey, lease);
      return true;
    });
  }

  async complete(
    workspaceId: string,
    identityKey: string,
    seatId: string,
    state: "sent" | "failed" | "released" | "suppressed",
  ): Promise<boolean> {
    const mapKey = `${workspaceId}::${identityKey}`;
    return this.withKeyLock(mapKey, () => {
      const lease = this.byKey.get(mapKey);
      if (!lease || lease.seatId !== seatId) return false;
      if (lease.state !== "leased" && lease.state !== "in_flight") return false;
      lease.state = state;
      if (state === "released" || state === "failed") {
        lease.expiresAt = Date.now();
      }
      this.byKey.set(mapKey, lease);
      return true;
    });
  }

  async sweepExpired(now = Date.now()): Promise<number> {
    let n = 0;
    for (const [key, lease] of this.byKey) {
      if (
        (lease.state === "leased" || lease.state === "in_flight") &&
        lease.expiresAt <= now
      ) {
        lease.state = "released";
        this.byKey.set(key, lease);
        n++;
      }
    }
    return n;
  }

  get(workspaceId: string, identityKey: string): ContactLease | undefined {
    return this.byKey.get(`${workspaceId}::${identityKey}`);
  }

  /** Snapshot for tests. */
  size(): number {
    return this.byKey.size;
  }
}

/** Knowledge plane must never call this — documented contract for audits. */
export function knowledgePlaneMayGrantContactClaim(): false {
  return false;
}
