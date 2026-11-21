/** No remote photo host. Aria does not load images from LinkedIn. */
export const CANDIDATE_PHOTO_HOST = "";

/**
 * Candidate photos are not fetched from a third party. The UI falls back to
 * initials. Returns "" for every input.
 */
export function candidatePhotoUrl(_raw: unknown): string {
  return "";
}
