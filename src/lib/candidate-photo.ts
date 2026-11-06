/** The only host candidate photos load from; next.config.mjs img-src matches. */
export const CANDIDATE_PHOTO_HOST = "media.licdn.com";

/**
 * A provider profile photo, kept only when it is an https image on LinkedIn's
 * media CDN. Anything else — another host, a data: URI, a tracking pixel
 * planted in a payload — is dropped so the browser never loads an arbitrary
 * third-party URL from candidate data. Returns "" when rejected.
 */
export function candidatePhotoUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2_000) return "";
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    return url.hostname.toLowerCase() === CANDIDATE_PHOTO_HOST ? url.href : "";
  } catch {
    return "";
  }
}
