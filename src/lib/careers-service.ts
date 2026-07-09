import {
  buildPublicCareerSubmission,
  publicCareerJobsFromState,
  type PublicCareerApplicationInput,
  type PublicCareerJob,
} from "./careers";
import { isRecentCareerSubmissionDuplicate } from "./careers-server";

export interface CareerWorkspaceRow {
  state: Record<string, unknown>;
  updatedAt: string;
}

/** Minimal persistence boundary used by the public careers route. */
export interface CareerWorkspaceRepository {
  load(workspaceId: string): Promise<CareerWorkspaceRow | null>;
  compareAndSet(workspaceId: string, expectedUpdatedAt: string, state: Record<string, unknown>): Promise<boolean>;
}

export type PublicCareerSubmissionResult = "accepted" | "duplicate" | "invalid" | "unavailable";

/** Null signals a missing or unreadable configured workspace, never a demo fallback. */
export async function loadPublicCareerJobs(
  repository: CareerWorkspaceRepository,
  workspaceId: string,
): Promise<PublicCareerJob[] | null> {
  const row = await repository.load(workspaceId);
  return row ? publicCareerJobsFromState(row.state) : null;
}

/**
 * Append a validated application using optimistic concurrency. The public caller
 * never writes a raw workspace blob and cannot choose a non-public campaign.
 */
export async function submitPublicCareerApplication(
  repository: CareerWorkspaceRepository,
  workspaceId: string,
  input: PublicCareerApplicationInput,
  createdAt = new Date().toISOString(),
): Promise<PublicCareerSubmissionResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await repository.load(workspaceId);
    if (!row) return "unavailable";

    const publicJobs = publicCareerJobsFromState(row.state);
    const submission = buildPublicCareerSubmission(input, publicJobs, createdAt);
    if (!submission) return "invalid";

    const existing = row.state.chatboxSubmissions;
    if (existing !== undefined && !Array.isArray(existing)) return "unavailable";
    const submissions = Array.isArray(existing) ? existing : [];
    if (isRecentCareerSubmissionDuplicate(submissions, submission, createdAt)) return "duplicate";

    const saved = await repository.compareAndSet(workspaceId, row.updatedAt, {
      ...row.state,
      chatboxSubmissions: [submission, ...submissions],
    });
    if (saved) return "accepted";
  }
  return "unavailable";
}
