/**
 * LinkedIn OpenID Connect helpers (Sign In with LinkedIn).
 * Real browser OAuth — no passwords, cookies, or scrape.
 */

export type LinkedInOAuthReadiness = {
  oauthConfigured: boolean;
  encryptionReady: boolean;
  assistedManual: true;
  vendorApiConfigured: boolean;
  inboundWebhookSecret: boolean;
};

export function linkedInOAuthConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.LINKEDIN_CLIENT_ID?.trim() && env.LINKEDIN_CLIENT_SECRET?.trim());
}

export function linkedInOAuthRedirectUri(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.LINKEDIN_REDIRECT_URI?.trim() ||
    `${(env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "")}/auth/linkedin/callback`
  );
}

export function linkedInProviderReadinessFull(
  env: Record<string, string | undefined> = process.env,
): LinkedInOAuthReadiness {
  const encryptionKey = env.DATA_ENCRYPTION_KEY?.trim() ?? "";
  return {
    oauthConfigured: linkedInOAuthConfigured(env),
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

export const LINKEDIN_OIDC_SCOPES = "openid profile email";

export const LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
export const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export type LinkedInUserInfo = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
  locale?: string;
};

export function displayNameFromLinkedInProfile(profile: LinkedInUserInfo): string {
  const name = (profile.name ?? "").trim();
  if (name) return name;
  const parts = [profile.given_name, profile.family_name].filter(Boolean).join(" ").trim();
  if (parts) return parts;
  if (profile.email?.trim()) return profile.email.trim();
  return `LinkedIn ${profile.sub.slice(0, 8)}`;
}
