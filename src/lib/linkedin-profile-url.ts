// LinkedIn profile URLs, client-safe and dependency-free: shared by the
// LinkedIn bridge (src/lib/linkedin-bridge) and manual candidate intake.

/**
 * The public id of a LinkedIn profile URL ("jane-doe" in
 * https://www.linkedin.com/in/jane-doe/), or null when the input is not one.
 */
export function publicIdFromProfileUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const match = /^\/in\/([^/?#]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return /^[\p{L}\p{N}_.-]{3,100}$/u.test(id) ? id : null;
}

/** The canonical profile URL for a public id. */
export function linkedInProfileUrl(publicId: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(publicId)}`;
}
