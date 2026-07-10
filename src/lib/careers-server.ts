import type { ChatboxSubmission } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1_000;

/** Returns a configured public careers tenant or null. There is no implicit tenant. */
export function parseCareersWorkspaceId(value: string | undefined): string | null {
  const workspaceId = value?.trim() ?? "";
  return UUID_RE.test(workspaceId) ? workspaceId : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Suppress accidental/replayed public submissions for 24 hours. The route returns
 * the same generic success response for duplicates, so this cannot be used to
 * enumerate prior applicants.
 */
export function isRecentCareerSubmissionDuplicate(
  existing: unknown,
  candidate: Pick<ChatboxSubmission, "email" | "campaignId" | "createdAt">,
  now = new Date().toISOString(),
): boolean {
  if (!Array.isArray(existing)) return false;
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return false;
  const email = candidate.email.trim().toLowerCase();
  const cutoff = nowMs - DUPLICATE_WINDOW_MS;
  return existing.some((raw) => {
    const item = asRecord(raw);
    if (!item || typeof item.email !== "string" || typeof item.createdAt !== "string") return false;
    if (item.email.trim().toLowerCase() !== email || item.campaignId !== candidate.campaignId) return false;
    const createdAt = Date.parse(item.createdAt);
    return Number.isFinite(createdAt) && createdAt >= cutoff && createdAt <= nowMs;
  });
}
