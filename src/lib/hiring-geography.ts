import type { Candidate, OutreachMessage } from "@/lib/types";
import { bookingNeedsCalendar } from "@/lib/booking-status";
import { isRealSendFact } from "@/lib/metrics";
import {
  isRemoteOrUnspecifiedLocation,
  resolveCountryFromLocation,
  type ResolvedCountry,
} from "@/lib/geo/resolve-country";

export interface CountryHiringStat {
  iso2: string;
  numericId: string;
  name: string;
  sourced: number;
  avgMatchScore: number;
  contacted: number;
  booked: number;
}

export interface HiringGeographyModel {
  byCountry: CountryHiringStat[];
  /** numericId → sourced count for choropleth fill */
  countByNumericId: Record<string, number>;
  totalSourced: number;
  countriesRepresented: number;
  remoteOrUnspecified: number;
  topCountry: CountryHiringStat | null;
  maxCount: number;
}

/** Booked KPI requires a real meeting/calendar URL — stage or booking shell is not enough. */
function candidateIsBooked(candidate: Candidate): boolean {
  return Boolean(candidate.booking && !bookingNeedsCalendar(candidate.booking));
}

/**
 * Aggregate hiring geography. Contacted counts require a real send fact
 * (`dryRun:false` + `sentAt`), not stage alone.
 */
export function deriveHiringGeography(
  candidates: Candidate[],
  outreach: Pick<OutreachMessage, "candidateId" | "dryRun" | "sentAt">[] = [],
): HiringGeographyModel {
  const contactedIds = new Set(
    outreach.filter((m) => isRealSendFact(m)).map((m) => m.candidateId),
  );
  const buckets = new Map<
    string,
    ResolvedCountry & { scores: number[]; sourced: number; contacted: number; booked: number }
  >();
  let remoteOrUnspecified = 0;

  for (const candidate of candidates) {
    const resolved = resolveCountryFromLocation(candidate.location ?? "");
    if (!resolved) {
      if (isRemoteOrUnspecifiedLocation(candidate.location ?? "") || !(candidate.location ?? "").trim()) {
        remoteOrUnspecified += 1;
      } else {
        remoteOrUnspecified += 1;
      }
      continue;
    }
    const existing = buckets.get(resolved.iso2) ?? {
      ...resolved,
      scores: [],
      sourced: 0,
      contacted: 0,
      booked: 0,
    };
    existing.sourced += 1;
    if (candidate.matchScore > 0) existing.scores.push(candidate.matchScore);
    if (contactedIds.has(candidate.id)) existing.contacted += 1;
    if (candidateIsBooked(candidate)) existing.booked += 1;
    buckets.set(resolved.iso2, existing);
  }

  const byCountry: CountryHiringStat[] = [...buckets.values()]
    .map((b) => ({
      iso2: b.iso2,
      numericId: b.numericId,
      name: b.name,
      sourced: b.sourced,
      avgMatchScore: b.scores.length
        ? Math.round(b.scores.reduce((s, n) => s + n, 0) / b.scores.length)
        : 0,
      contacted: b.contacted,
      booked: b.booked,
    }))
    .sort((a, b) => b.sourced - a.sourced || a.name.localeCompare(b.name));

  const countByNumericId: Record<string, number> = {};
  for (const row of byCountry) countByNumericId[row.numericId] = row.sourced;

  const maxCount = byCountry.reduce((m, row) => Math.max(m, row.sourced), 0);

  return {
    byCountry,
    countByNumericId,
    totalSourced: candidates.length,
    countriesRepresented: byCountry.length,
    remoteOrUnspecified,
    topCountry: byCountry[0] ?? null,
    maxCount,
  };
}

/** Sequential fill scale — Bklit chart-scale style using CSS vars. */
export function choroplethFill(
  count: number,
  maxCount: number,
): string {
  if (count <= 0 || maxCount <= 0) return "hsl(var(--line) / 0.55)";
  const t = count / maxCount;
  if (t < 0.2) return "hsl(var(--electric) / 0.25)";
  if (t < 0.4) return "hsl(var(--electric) / 0.4)";
  if (t < 0.6) return "hsl(var(--electric) / 0.55)";
  if (t < 0.8) return "hsl(var(--electric) / 0.72)";
  return "hsl(var(--electric) / 0.92)";
}
