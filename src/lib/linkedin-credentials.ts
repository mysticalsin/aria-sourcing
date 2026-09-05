/**
 * Resolve LinkedIn OIDC / vendor API / computer-supervisor credentials from
 * Aria Settings (vault key ids + non-secret URLs) with env fallback.
 * Secrets never leave the vault except at the immediate call site.
 *
 * Do not import this module from Client Components — Settings UI must use
 * `@/lib/linkedin-vault-providers` for provider labels only.
 */

import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { decryptSecret } from "@/lib/crypto-secrets";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { LinkedInProviderReadiness } from "@/lib/linkedin-connections";
import {
  COMPUTER_SUPERVISOR_VAULT_PROVIDER,
  LINKEDIN_OIDC_VAULT_PROVIDER,
  LINKEDIN_VENDOR_VAULT_PROVIDER,
} from "@/lib/linkedin-vault-providers";

export {
  COMPUTER_SUPERVISOR_VAULT_PROVIDER,
  LINKEDIN_OIDC_VAULT_PROVIDER,
  LINKEDIN_VENDOR_VAULT_PROVIDER,
} from "@/lib/linkedin-vault-providers";

export type LinkedInCredentialRefs = {
  /** Public OIDC client id (not a secret). */
  clientId?: string | null;
  /** ApiKey.id under provider "LinkedIn OIDC". */
  clientSecretKeyId?: string | null;
  /** Vendor HTTP endpoint. */
  vendorApiUrl?: string | null;
  /** ApiKey.id under provider "LinkedIn Vendor API". */
  vendorApiKeyId?: string | null;
  /** Computer supervisor base URL. */
  computerSupervisorUrl?: string | null;
  /** ApiKey.id under provider "Computer Supervisor". */
  computerSupervisorTokenKeyId?: string | null;
};

export type LinkedInResolvedCredentials = {
  clientId: string;
  clientSecret: string;
  vendorApiUrl: string;
  vendorApiKey: string;
  computerSupervisorUrl: string;
  computerSupervisorToken: string;
  computerSupervisorMockSend: boolean;
};

function trim(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const next = trim(value);
    if (next) return next;
  }
  return "";
}

/** Pull LinkedIn credential refs from SystemSettings (or a loose settings bag). */
export function extractLinkedInCredentialRefs(settings: unknown): LinkedInCredentialRefs {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const s = settings as Record<string, unknown>;
  return {
    clientId: typeof s.linkedinClientId === "string" ? s.linkedinClientId : "",
    clientSecretKeyId:
      typeof s.linkedinClientSecretKeyId === "string" ? s.linkedinClientSecretKeyId : "",
    vendorApiUrl: typeof s.linkedinVendorApiUrl === "string" ? s.linkedinVendorApiUrl : "",
    vendorApiKeyId: typeof s.linkedinVendorApiKeyId === "string" ? s.linkedinVendorApiKeyId : "",
    computerSupervisorUrl:
      typeof s.computerSupervisorUrl === "string" ? s.computerSupervisorUrl : "",
    computerSupervisorTokenKeyId:
      typeof s.computerSupervisorTokenKeyId === "string" ? s.computerSupervisorTokenKeyId : "",
  };
}

function fromEnv(env: Record<string, string | undefined> = process.env): LinkedInResolvedCredentials {
  return {
    clientId: trim(env.LINKEDIN_CLIENT_ID),
    clientSecret: trim(env.LINKEDIN_CLIENT_SECRET),
    vendorApiUrl: trim(env.LINKEDIN_VENDOR_API_URL),
    vendorApiKey: trim(env.LINKEDIN_VENDOR_API_KEY),
    computerSupervisorUrl: trim(env.COMPUTER_SUPERVISOR_URL),
    computerSupervisorToken: trim(env.COMPUTER_SUPERVISOR_TOKEN),
    computerSupervisorMockSend: env.COMPUTER_SUPERVISOR_MOCK_SEND === "1",
  };
}

/**
 * Session-scoped resolve (API routes with a signed-in user).
 * Vault key ids win when present; otherwise env fallback keeps ops plug-and-play.
 */
export async function resolveLinkedInCredentials(
  refs: LinkedInCredentialRefs = {},
  env: Record<string, string | undefined> = process.env,
): Promise<LinkedInResolvedCredentials> {
  const fallback = fromEnv(env);
  const clientSecret =
    (await resolveVaultSecret(refs.clientSecretKeyId ?? undefined, LINKEDIN_OIDC_VAULT_PROVIDER)) ||
    fallback.clientSecret;
  const vendorApiKey =
    (await resolveVaultSecret(refs.vendorApiKeyId ?? undefined, LINKEDIN_VENDOR_VAULT_PROVIDER)) ||
    fallback.vendorApiKey;
  const computerSupervisorToken =
    (await resolveVaultSecret(
      refs.computerSupervisorTokenKeyId ?? undefined,
      COMPUTER_SUPERVISOR_VAULT_PROVIDER,
    )) || fallback.computerSupervisorToken;

  return {
    clientId: firstNonEmpty(refs.clientId, fallback.clientId),
    clientSecret,
    vendorApiUrl: firstNonEmpty(refs.vendorApiUrl, fallback.vendorApiUrl),
    vendorApiKey,
    computerSupervisorUrl: firstNonEmpty(refs.computerSupervisorUrl, fallback.computerSupervisorUrl),
    computerSupervisorToken,
    computerSupervisorMockSend: fallback.computerSupervisorMockSend,
  };
}

async function decryptVaultRow(
  workspaceId: string,
  keyId: string | null | undefined,
  expectedProvider: string,
): Promise<string> {
  if (!keyId) return "";
  const svc = getServiceSupabase();
  if (!svc) return "";
  const { data: row } = await svc
    .from("api_keys")
    .select("secret, workspace_id, provider, status")
    .eq("id", keyId)
    .eq("workspace_id", workspaceId)
    .eq("provider", expectedProvider)
    .eq("status", "valid")
    .maybeSingle();
  if (
    !row ||
    row.workspace_id !== workspaceId ||
    row.provider !== expectedProvider ||
    row.status !== "valid" ||
    typeof row.secret !== "string"
  ) {
    return "";
  }
  return decryptSecret(row.secret);
}

/**
 * Service-role resolve for cron / dispatch (no user session).
 * Always scopes api_keys reads to the given workspace id.
 */
export async function resolveLinkedInCredentialsForWorkspace(
  workspaceId: string,
  refs: LinkedInCredentialRefs = {},
  env: Record<string, string | undefined> = process.env,
): Promise<LinkedInResolvedCredentials> {
  const fallback = fromEnv(env);
  const clientSecret =
    (await decryptVaultRow(workspaceId, refs.clientSecretKeyId, LINKEDIN_OIDC_VAULT_PROVIDER)) ||
    fallback.clientSecret;
  const vendorApiKey =
    (await decryptVaultRow(workspaceId, refs.vendorApiKeyId, LINKEDIN_VENDOR_VAULT_PROVIDER)) ||
    fallback.vendorApiKey;
  const computerSupervisorToken =
    (await decryptVaultRow(
      workspaceId,
      refs.computerSupervisorTokenKeyId,
      COMPUTER_SUPERVISOR_VAULT_PROVIDER,
    )) || fallback.computerSupervisorToken;

  return {
    clientId: firstNonEmpty(refs.clientId, fallback.clientId),
    clientSecret,
    vendorApiUrl: firstNonEmpty(refs.vendorApiUrl, fallback.vendorApiUrl),
    vendorApiKey,
    computerSupervisorUrl: firstNonEmpty(refs.computerSupervisorUrl, fallback.computerSupervisorUrl),
    computerSupervisorToken,
    computerSupervisorMockSend: fallback.computerSupervisorMockSend,
  };
}

/** Load credential refs from workspace_state.settings for a workspace. */
export async function loadLinkedInCredentialRefsForWorkspace(
  workspaceId: string,
): Promise<LinkedInCredentialRefs> {
  const svc = getServiceSupabase();
  if (!svc || !workspaceId) return {};
  const { data: row } = await svc
    .from("workspace_state")
    .select("state")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const state = row?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const settings = (state as Record<string, unknown>).settings;
  return extractLinkedInCredentialRefs(settings);
}

export function linkedInReadinessFromCredentials(
  creds: LinkedInResolvedCredentials,
  env: Record<string, string | undefined> = process.env,
): LinkedInProviderReadiness {
  const encryptionKey = trim(env.DATA_ENCRYPTION_KEY);
  return {
    oauthConfigured: Boolean(creds.clientId && creds.clientSecret),
    encryptionReady: encryptionKey.length >= 32,
    assistedManual: true,
    vendorApiConfigured: Boolean(creds.vendorApiUrl && creds.vendorApiKey),
    browserComputerConfigured: Boolean(
      creds.computerSupervisorUrl || creds.computerSupervisorMockSend,
    ),
    inboundWebhookSecret: Boolean(
      trim(env.LINKEDIN_INBOUND_WEBHOOK_SECRET ?? env.EMAIL_INBOUND_WEBHOOK_SECRET),
    ),
  };
}

export function vendorApiConfigured(creds?: Partial<LinkedInResolvedCredentials>): boolean {
  const url = firstNonEmpty(creds?.vendorApiUrl, process.env.LINKEDIN_VENDOR_API_URL);
  const key = firstNonEmpty(creds?.vendorApiKey, process.env.LINKEDIN_VENDOR_API_KEY);
  return Boolean(url && key);
}

export function browserComputerConfigured(creds?: Partial<LinkedInResolvedCredentials>): boolean {
  const url = firstNonEmpty(creds?.computerSupervisorUrl, process.env.COMPUTER_SUPERVISOR_URL);
  const mock =
    creds?.computerSupervisorMockSend === true || process.env.COMPUTER_SUPERVISOR_MOCK_SEND === "1";
  return Boolean(url || mock);
}
