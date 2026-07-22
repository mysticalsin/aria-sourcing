/** Normalize a complete login address without inventing an identity domain. */
export function normalizeLoginEmail(
  value: string,
  allowedDomain: string,
): string | null {
  const email = value.trim();
  if (
    email !== value
    || email.length < 3
    || email.length > 254
    || /[\u0000-\u0020\u007f]/.test(email)
  ) return null;

  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@") || at > 64 || at === email.length - 1) {
    return null;
  }
  const domain = email.slice(at + 1).toLowerCase();
  if (
    domain.length > 253
    || domain.startsWith(".")
    || domain.endsWith(".")
    || domain.includes("..")
    || !/^[a-z0-9.-]+$/.test(domain)
  ) return null;

  const requiredDomain = allowedDomain.trim().toLowerCase();
  if (requiredDomain && domain !== requiredDomain) return null;
  return `${email.slice(0, at)}@${domain}`;
}
