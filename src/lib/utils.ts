import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type {
  BookingStatus,
  CandidateStage,
  IntegrationHealth,
  OutreachStatus,
  ReplyIntent,
  Urgency,
} from "./types";

/* ---- Class names --------------------------------------------------------- */

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ---- Deterministic seed clock -------------------------------------------
   Fixed reference so seed data is identical on server and client (no hydration
   drift). Runtime "time ago" uses the real clock, but only inside components
   that render after mount (store exposes `hydrated`).                         */

export const SEED_NOW = new Date("2026-06-26T09:00:00.000Z");

export function isoDaysBefore(days: number, base: Date = SEED_NOW): string {
  return new Date(base.getTime() - days * 86_400_000).toISOString();
}
export function isoHoursBefore(hours: number, base: Date = SEED_NOW): string {
  return new Date(base.getTime() - hours * 3_600_000).toISOString();
}
export function isoDaysAfter(days: number, base: Date = SEED_NOW): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString();
}

/* ---- IDs / slugs --------------------------------------------------------- */

let __idCounter = 0;
export function genId(prefix: string): string {
  __idCounter += 1;
  const t = Date.now().toString(36);
  const c = __idCounter.toString(36);
  return `${prefix}_${t}${c}`;
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export function campaignId(title: string): string {
  return `camp_${Date.now()}_${slugify(title) || "role"}`;
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ---- Deterministic PRNG (mulberry32) ------------------------------------- */

export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickN<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/* ---- Numeric / formatting ------------------------------------------------ */

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatPercent(value0to1: number, dp = 0): string {
  return `${round(value0to1 * 100, dp)}%`;
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatSalaryRange(
  min: number | null,
  max: number | null,
  currency = "USD",
): string {
  if (min == null && max == null) return "Not specified";
  const fmt = (n: number) => {
    const k = n / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  };
  const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  if (min != null && max != null) return `${symbol}${fmt(min)}–${symbol}${fmt(max)}`;
  if (min != null) return `${symbol}${fmt(min)}+`;
  return `Up to ${symbol}${fmt(max as number)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

/* ---- Timezones -------------------------------------------------------------
   Candidates/bookings only carry a short zone label (e.g. "CET") drawn from a
   small fixed set of demo regions, not a real IANA zone id. Rendering a booking
   time with plain toLocaleTimeString()/toUTCString() ignores that label entirely,
   so the number shown is silently wrong for every zone but UTC. This maps the
   label to a real IANA zone so booking times render as genuine local wall-clock
   time. Unknown/blank labels (live-sourced candidates with no known location)
   fall back to UTC rather than guessing. */
const IANA_BY_ABBREVIATION: Record<string, string> = {
  CET: "Europe/Berlin",
  WET: "Europe/Lisbon",
  GMT: "Europe/London",
  CST: "America/Chicago",
  EST: "America/Toronto",
  IST: "Asia/Kolkata",
  SGT: "Asia/Singapore",
  BRT: "America/Sao_Paulo",
};

export function ianaForAbbrev(abbrev: string): string {
  return IANA_BY_ABBREVIATION[abbrev] ?? "UTC";
}

/** Human "time ago" / "in X". Safe to call post-mount only. */
export function formatTimeAgo(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let label: string;
  if (abs < 45_000) label = "just now";
  else if (mins < 60) label = `${mins}m`;
  else if (hours < 24) label = `${hours}h`;
  else if (days < 30) label = `${days}d`;
  else label = formatDate(iso);
  if (label === "just now") return label;
  return future ? `in ${label}` : `${label} ago`;
}

/** Countdown like "12m left" / "overdue 4m" for SLA timers. */
export function formatCountdown(iso: string, now: number = Date.now()): {
  label: string;
  overdue: boolean;
} {
  const diff = new Date(iso).getTime() - now;
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  const secs = Math.floor((abs % 60000) / 1000);
  const body = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m ${secs}s`;
  return { label: overdue ? `Overdue ${body}` : `${body} left`, overdue };
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return `${formatNumber(n)} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

/* ---- Browser helpers ----------------------------------------------------- */

export const isBrowser = typeof window !== "undefined";

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

export function downloadText(filename: string, text: string, mime = "text/markdown"): void {
  if (!isBrowser) return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---- Semantic tone maps (shared by Badge + chips) ------------------------ */

export type Tone =
  | "neutral"
  | "tangerine"
  | "electric"
  | "aqua"
  | "violet"
  | "success"
  | "warning"
  | "danger";

export function toneForStage(stage: CandidateStage): Tone {
  switch (stage) {
    case "Sourced":
      return "neutral";
    case "Contacted":
      return "electric";
    case "Replied":
      return "aqua";
    case "Interested":
      return "tangerine";
    case "Booked":
      return "violet";
    case "Interviewed":
      return "violet";
    case "Offer":
      return "success";
    case "Hired":
      return "success";
    case "Not Interested":
      return "warning";
    case "Rejected":
      return "danger";
    case "Suppressed":
      return "danger";
    default:
      return "neutral";
  }
}

export function toneForUrgency(u: Urgency): Tone {
  switch (u) {
    case "ASAP":
    case "Critical":
      return "danger";
    case "Urgent":
      return "tangerine";
    case "This Week":
      return "warning";
    default:
      return "neutral";
  }
}

export function toneForIntent(intent: ReplyIntent): Tone {
  switch (intent) {
    case "INTERESTED":
      return "success";
    case "QUALIFIED_INTEREST":
      return "tangerine";
    case "REFERRAL":
      return "electric";
    case "OOO":
      return "aqua";
    case "UNCLEAR":
      return "warning";
    case "NOT_INTERESTED":
      return "neutral";
    case "NEGATIVE":
      return "danger";
    default:
      return "neutral";
  }
}

export function toneForOutreachStatus(s: OutreachStatus): Tone {
  switch (s) {
    case "Draft":
      return "neutral";
    case "Needs Approval":
      return "warning";
    case "Approved":
      return "success";
    case "Pending Manual Send":
      return "tangerine";
    case "Scheduled":
      return "electric";
    case "Rejected":
      return "danger";
    default:
      return "neutral";
  }
}

export function toneForBookingStatus(s: BookingStatus): Tone {
  switch (s) {
    case "Confirmed":
      return "success";
    case "Proposed":
      return "tangerine";
    case "Completed":
      return "violet";
    case "Cancelled":
      return "danger";
    case "No Show":
      return "warning";
    default:
      return "neutral";
  }
}

export function toneForHealth(h: IntegrationHealth): Tone {
  switch (h) {
    case "connected":
      return "success";
    case "degraded":
      return "warning";
    case "error":
      return "danger";
    case "not_configured":
      return "neutral";
    default:
      return "neutral";
  }
}

export function scoreTone(score: number): Tone {
  if (score >= 85) return "success";
  if (score >= 70) return "tangerine";
  if (score >= 55) return "warning";
  return "danger";
}
