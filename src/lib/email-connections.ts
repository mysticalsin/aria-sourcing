/**
 * Pure helpers for Settings → Email connections (Gmail / Outlook / API senders).
 * No secrets, no network — safe for unit tests and shared by API + UI.
 */

export type MailboxOAuthProvider = "Gmail API" | "Microsoft Graph";

export type EmailProviderReadiness = {
  gmailOAuth: boolean;
  microsoftOAuth: boolean;
  sendgridApiKey: boolean;
  resendApiKey: boolean;
  encryptionReady: boolean;
  inboundWebhookSecret: boolean;
};

/** Env readiness for mailbox OAuth and transactional senders (booleans only). */
export function emailProviderReadiness(
  env: Record<string, string | undefined> = process.env,
): EmailProviderReadiness {
  const encryptionKey = (env.DATA_ENCRYPTION_KEY ?? "").trim();
  const production = env.NODE_ENV === "production";
  return {
    gmailOAuth: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()),
    microsoftOAuth: Boolean(env.MICROSOFT_CLIENT_ID?.trim() && env.MICROSOFT_CLIENT_SECRET?.trim()),
    sendgridApiKey: Boolean(env.SENDGRID_API_KEY?.trim()),
    resendApiKey: Boolean(env.RESEND_API_KEY?.trim()),
    // Matches encryptionRequiredButMissing(): production requires a key; elsewhere a key is optional.
    encryptionReady: production ? encryptionKey.length > 0 : true,
    inboundWebhookSecret: Boolean(env.EMAIL_INBOUND_WEBHOOK_SECRET?.trim()),
  };
}

export function oauthAuthorizePath(provider: MailboxOAuthProvider): "/auth/google" | "/auth/microsoft" {
  return provider === "Gmail API" ? "/auth/google" : "/auth/microsoft";
}

export function oauthConfiguredFor(
  provider: MailboxOAuthProvider,
  readiness: EmailProviderReadiness,
): boolean {
  return provider === "Gmail API" ? readiness.gmailOAuth : readiness.microsoftOAuth;
}

export type SeatForConnect = {
  id: string;
  name: string;
  provider: string;
  connectedAccount: string | null | undefined;
};

/**
 * Prefer an existing seat of the requested OAuth provider that is not yet
 * connected; otherwise the first seat of that provider (reconnect).
 */
export function pickSeatForConnect(
  seats: SeatForConnect[],
  provider: MailboxOAuthProvider,
): SeatForConnect | null {
  const matching = seats.filter((s) => s.provider === provider);
  if (matching.length === 0) return null;
  const free = matching.find((s) => !s.connectedAccount?.trim());
  return free ?? matching[0] ?? null;
}

export function defaultSeatNameFor(provider: MailboxOAuthProvider): string {
  return provider === "Gmail API" ? "Gmail mailbox" : "Outlook mailbox";
}

export type ConnectionHealthInput = {
  accountEmail: string;
  hasRefreshToken: boolean;
  expiresAt: string | null;
  inboundRouteActive: boolean;
  nowMs?: number;
};

export type ConnectionHealth = "connected" | "degraded" | "error";

/** Derive UI health without calling providers. */
export function connectionHealth(input: ConnectionHealthInput): ConnectionHealth {
  if (!input.accountEmail.trim()) return "error";
  if (!input.hasRefreshToken) return "error";
  if (!input.inboundRouteActive) return "degraded";
  const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : NaN;
  if (Number.isFinite(expiresAt)) {
    const now = input.nowMs ?? Date.now();
    // Access tokens expire; refresh should still work — flag only if already expired
    // AND we somehow lack a refresh path (already checked). Soft warn window unused.
    if (expiresAt < now - 60_000 && !input.hasRefreshToken) return "error";
  }
  return "connected";
}

export type EmailValidationCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

/** Aggregate validation checklist for Settings Test Connection. */
export function summarizeEmailValidation(checks: EmailValidationCheck[]): {
  ok: boolean;
  message: string;
  checks: EmailValidationCheck[];
} {
  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    return { ok: true, message: "Mailbox ready: token, profile, and inbound route validated.", checks };
  }
  return {
    ok: false,
    message: failed.map((c) => c.detail).join(" · "),
    checks,
  };
}

export function normalizeMailboxAddress(email: string): string {
  return email.trim().toLowerCase();
}
