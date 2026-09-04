/**
 * Pure helpers for Settings → LinkedIn messaging (OIDC login + assisted-manual + vendor).
 * No LinkedIn passwords, session cookies, or scrape — ever.
 */

export type LinkedInSeatProvider = "LinkedIn Assisted Manual" | "LinkedIn Vendor API";

export type LinkedInProviderReadiness = {
  /** Sign In with LinkedIn (OpenID Connect) client configured. */
  oauthConfigured: boolean;
  encryptionReady: boolean;
  assistedManual: true;
  vendorApiConfigured: boolean;
  inboundWebhookSecret: boolean;
};

export function linkedInProviderReadiness(
  env: Record<string, string | undefined> = process.env,
): LinkedInProviderReadiness {
  const encryptionKey = env.DATA_ENCRYPTION_KEY?.trim() ?? "";
  return {
    oauthConfigured: Boolean(env.LINKEDIN_CLIENT_ID?.trim() && env.LINKEDIN_CLIENT_SECRET?.trim()),
    encryptionReady: encryptionKey.length >= 32,
    assistedManual: true,
    vendorApiConfigured: Boolean(
      env.LINKEDIN_VENDOR_API_URL?.trim() && env.LINKEDIN_VENDOR_API_KEY?.trim(),
    ),
    inboundWebhookSecret: Boolean(
      (env.LINKEDIN_INBOUND_WEBHOOK_SECRET ?? env.EMAIL_INBOUND_WEBHOOK_SECRET)?.trim(),
    ),
  };
}

export function isLinkedInSeatProvider(provider: string | null | undefined): provider is LinkedInSeatProvider {
  return provider === "LinkedIn Assisted Manual" || provider === "LinkedIn Vendor API";
}

export function defaultLinkedInSeatName(provider: LinkedInSeatProvider): string {
  return provider === "LinkedIn Vendor API" ? "LinkedIn Vendor" : "My LinkedIn (manual)";
}

export type LinkedInSeatRow = {
  id: string;
  name: string;
  provider: string;
  status: string;
  mode: string;
  connectedAccount?: string | null;
  operatorEmail?: string;
};

/** Prefer an existing LinkedIn assisted-manual seat; else first LinkedIn seat. */
export function pickLinkedInSeat(
  seats: LinkedInSeatRow[],
  prefer: LinkedInSeatProvider = "LinkedIn Assisted Manual",
): LinkedInSeatRow | null {
  const matching = seats.filter((s) => s.provider === prefer);
  if (matching.length > 0) return matching[0] ?? null;
  const any = seats.filter((s) => isLinkedInSeatProvider(s.provider));
  return any[0] ?? null;
}

/** Live mode for LinkedIn does not require mailbox SPF — operator sends in LinkedIn. */
export function linkedInSeatCanGoLive(seat: {
  provider: string;
  status?: string;
}): { ok: boolean; reason: string } {
  if (!isLinkedInSeatProvider(seat.provider)) {
    return { ok: false, reason: "Not a LinkedIn messaging seat." };
  }
  if (seat.status && seat.status !== "active") {
    return { ok: false, reason: "Seat must be active before going live." };
  }
  return { ok: true, reason: "Ready for automatic vendor delivery or Manual approve-and-send." };
}

export function normalizeLinkedInProfileUrl(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (!/linkedin\.com\/(in|pub)\//i.test(value)) return null;
  try {
    const url = value.startsWith("http") ? new URL(value) : new URL(`https://${value}`);
    if (!url.hostname.includes("linkedin.com")) return null;
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export type LinkedInValidationCheck = { id: string; ok: boolean; detail: string };

export function summarizeLinkedInValidation(checks: LinkedInValidationCheck[]): {
  ok: boolean;
  message: string;
  checks: LinkedInValidationCheck[];
} {
  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    return {
      ok: true,
      message: "LinkedIn messaging ready: seat live, adapter configured, inbound route present.",
      checks,
    };
  }
  return { ok: false, message: failed.map((c) => c.detail).join(" · "), checks };
}
