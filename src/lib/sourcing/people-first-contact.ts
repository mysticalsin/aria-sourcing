/**
 * People-first shortlist requires real contact channels. Do not invent them.
 */
import { isSyntheticRecipientEmail } from "@/lib/sourcing/people-connect";

export function isRealLinkedInProfileUrl(url: string | undefined): boolean {
  const raw = url?.trim() ?? "";
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return false;
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return false;
    return /\/in\/[A-Za-z0-9._%-]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isRealPhoneNumber(phone: string | undefined): boolean {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function isPeopleFirstContactComplete(candidate: {
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  sourcePlatform?: string;
}): boolean {
  if (candidate.sourcePlatform === "GitHub") return false;
  const email = candidate.email?.trim() ?? "";
  if (!email || isSyntheticRecipientEmail(email)) return false;
  if (!isRealPhoneNumber(candidate.phone)) return false;
  if (!isRealLinkedInProfileUrl(candidate.linkedinUrl)) return false;
  return true;
}
