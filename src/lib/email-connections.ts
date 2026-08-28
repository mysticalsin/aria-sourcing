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

/**
 * Microsoft OAuth redirect must be explicitly configured. In production it must be
 * a public https URL (never localhost) — otherwise Connect Outlook looks "ready"
 * while authorize falls back to http://localhost:3000/... and breaks live Fly.
 */
export function microsoftRedirectUriReady(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const uri = (env.MICROSOFT_REDIRECT_URI ?? "").trim();
  if (!uri) return false;
  try {
    const parsed = new URL(uri);
    if (env.NODE_ENV === "production") {
      if (parsed.protocol !== "https:") return false;
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Resolve authorize/callback redirect; null means fail closed (do not use localhost in prod). */
export function resolveMicrosoftRedirectUri(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = (env.MICROSOFT_REDIRECT_URI ?? "").trim();
  if (configured) {
    return microsoftRedirectUriReady({ ...env, MICROSOFT_REDIRECT_URI: configured })
      ? configured
      : null;
  }
  if (env.NODE_ENV === "production") return null;
  return "http://localhost:3000/auth/microsoft/callback";
}

const TENANT_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve Entra tenant for Graph mailbox OAuth.
 * Prefer MICROSOFT_TENANT_ID; else parse GOTRUE_EXTERNAL_AZURE_URL
 * (`https://login.microsoftonline.com/<tenant>/v2.0`).
 * Single-tenant apps fail with AADSTS50194 if authorize/token hit `/common/`.
 */
export function resolveMicrosoftTenantId(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = (env.MICROSOFT_TENANT_ID ?? "").trim();
  if (explicit && TENANT_GUID_RE.test(explicit)) return explicit.toLowerCase();

  const azureUrl = (env.GOTRUE_EXTERNAL_AZURE_URL ?? "").trim();
  if (azureUrl) {
    try {
      const path = new URL(azureUrl).pathname.replace(/^\/+|\/+$/g, "");
      const tenant = path.split("/")[0] ?? "";
      if (TENANT_GUID_RE.test(tenant)) return tenant.toLowerCase();
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * OAuth v2 authority base (…/oauth2/v2.0) for authorize + token.
 * Production: require a resolved tenant (single-tenant Fly path).
 * Non-production without tenant: `organizations` (never `/common/` for work apps).
 */
export function resolveMicrosoftOAuthAuthority(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const tenant = resolveMicrosoftTenantId(env);
  if (tenant) {
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  }
  if (env.NODE_ENV === "production") return null;
  return "https://login.microsoftonline.com/organizations/oauth2/v2.0";
}

/** Env readiness for mailbox OAuth and transactional senders (booleans only). */
export function emailProviderReadiness(
  env: Record<string, string | undefined> = process.env,
): EmailProviderReadiness {
  const encryptionKey = (env.DATA_ENCRYPTION_KEY ?? "").trim();
  const production = env.NODE_ENV === "production";
  return {
    gmailOAuth: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()),
    microsoftOAuth: Boolean(
      env.MICROSOFT_CLIENT_ID?.trim()
        && env.MICROSOFT_CLIENT_SECRET?.trim()
        && microsoftRedirectUriReady(env),
    ),
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
    return { ok: true, message: "Mailbox ready: token, profile, inbound route, and webhook validated.", checks };
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
