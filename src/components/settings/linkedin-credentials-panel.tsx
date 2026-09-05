"use client";

import * as React from "react";
import { KeyRound, Link2, Monitor } from "lucide-react";
import { Field, Input, Select, useToast } from "@/components/ui";
import { useActions, useApiKeys, useRole, useSettings } from "@/lib/store";
import { can } from "@/lib/rbac";
import {
  COMPUTER_SUPERVISOR_VAULT_PROVIDER,
  LINKEDIN_OIDC_VAULT_PROVIDER,
  LINKEDIN_VENDOR_VAULT_PROVIDER,
} from "@/lib/linkedin-vault-providers";

/**
 * Plug-and-play LinkedIn credential binding for Aria Settings.
 * Secrets live in the API key vault; this panel only stores ids + non-secret URLs.
 * Env vars remain a fallback for ops that prefer Fly secrets.
 */
export function LinkedInCredentialsPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_providers") || can(role, "manage_keys");
  const settings = useSettings();
  const apiKeys = useApiKeys();
  const actions = useActions();
  const { toast } = useToast();

  const oidcKeys = apiKeys.filter((k) => k.provider === LINKEDIN_OIDC_VAULT_PROVIDER);
  const vendorKeys = apiKeys.filter((k) => k.provider === LINKEDIN_VENDOR_VAULT_PROVIDER);
  const supervisorKeys = apiKeys.filter((k) => k.provider === COMPUTER_SUPERVISOR_VAULT_PROVIDER);

  function keyOptions(
    keys: typeof apiKeys,
    emptyLabel: string,
  ): Array<{ value: string; label: string }> {
    return [
      { value: "", label: emptyLabel },
      ...keys.map((k) => ({
        value: k.id,
        label: `${k.name} (••••${k.last4})`,
      })),
    ];
  }

  function patch(partial: Record<string, string>) {
    actions.updateSettings(partial);
    toast({ title: "LinkedIn settings saved", variant: "success" });
  }

  if (!isAdmin) {
    return (
      <div className="border-b border-line/60 px-6 py-5 sm:px-8">
        <p className="text-xs text-muted">
          Admins attach LinkedIn OIDC, vendor API, and computer-supervisor keys in Aria Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 border-b border-line/60 px-6 py-5 sm:px-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Aria API keys</p>
        <p className="mt-1 text-sm text-ink">
          Paste secrets once under API keys, then attach them here. No Fly redeploy needed for
          workspace-scoped keys — env vars remain an optional fallback.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="OIDC client id"
          htmlFor="linkedinClientId"
          hint="Public LinkedIn app client id (Developer Portal → Auth)."
        >
          <Input
            id="linkedinClientId"
            value={settings.linkedinClientId ?? ""}
            onChange={(e) => actions.updateSettings({ linkedinClientId: e.target.value })}
            onBlur={(e) => patch({ linkedinClientId: e.target.value })}
            placeholder="86abc…"
            autoComplete="off"
          />
        </Field>
        <Field
          label="OIDC client secret"
          htmlFor="linkedinClientSecretKeyId"
          hint={`Vault key provider “${LINKEDIN_OIDC_VAULT_PROVIDER}”.`}
        >
          <Select
            id="linkedinClientSecretKeyId"
            value={settings.linkedinClientSecretKeyId ?? ""}
            onChange={(e) => patch({ linkedinClientSecretKeyId: e.target.value })}
            options={keyOptions(oidcKeys, "None (uses LINKEDIN_CLIENT_SECRET env)")}
          />
        </Field>

        <Field
          label="Vendor API URL"
          htmlFor="linkedinVendorApiUrl"
          hint="Entitled vendor messaging endpoint for automatic sends."
        >
          <Input
            id="linkedinVendorApiUrl"
            value={settings.linkedinVendorApiUrl ?? ""}
            onChange={(e) => actions.updateSettings({ linkedinVendorApiUrl: e.target.value })}
            onBlur={(e) => patch({ linkedinVendorApiUrl: e.target.value })}
            placeholder="https://vendor.example/v1/linkedin/messages"
            autoComplete="off"
          />
        </Field>
        <Field
          label="Vendor API key"
          htmlFor="linkedinVendorApiKeyId"
          hint={`Vault key provider “${LINKEDIN_VENDOR_VAULT_PROVIDER}”.`}
        >
          <Select
            id="linkedinVendorApiKeyId"
            value={settings.linkedinVendorApiKeyId ?? ""}
            onChange={(e) => patch({ linkedinVendorApiKeyId: e.target.value })}
            options={keyOptions(vendorKeys, "None (uses LINKEDIN_VENDOR_API_KEY env)")}
          />
        </Field>

        <Field
          label="Computer supervisor URL"
          htmlFor="computerSupervisorUrl"
          hint="OpenBot-shaped Chromium supervisor base URL for browser-computer seats."
        >
          <Input
            id="computerSupervisorUrl"
            value={settings.computerSupervisorUrl ?? ""}
            onChange={(e) => actions.updateSettings({ computerSupervisorUrl: e.target.value })}
            onBlur={(e) => patch({ computerSupervisorUrl: e.target.value })}
            placeholder="https://computers.example"
            autoComplete="off"
          />
        </Field>
        <Field
          label="Supervisor token"
          htmlFor="computerSupervisorTokenKeyId"
          hint={`Vault key provider “${COMPUTER_SUPERVISOR_VAULT_PROVIDER}”.`}
        >
          <Select
            id="computerSupervisorTokenKeyId"
            value={settings.computerSupervisorTokenKeyId ?? ""}
            onChange={(e) => patch({ computerSupervisorTokenKeyId: e.target.value })}
            options={keyOptions(supervisorKeys, "None (uses COMPUTER_SUPERVISOR_TOKEN env)")}
          />
        </Field>
      </div>

      <ul className="grid gap-2 text-xs text-muted sm:grid-cols-3">
        <li className="flex items-start gap-2 rounded-xl border border-line/70 bg-surface px-3 py-2">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" aria-hidden />
          <span>
            Add keys under <span className="font-medium text-ink-soft">API keys</span> with the
            LinkedIn providers above, then attach them here.
          </span>
        </li>
        <li className="flex items-start gap-2 rounded-xl border border-line/70 bg-surface px-3 py-2">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" aria-hidden />
          <span>OIDC powers Sign in with LinkedIn. Vendor URL + key powers automatic Vendor API seats.</span>
        </li>
        <li className="flex items-start gap-2 rounded-xl border border-line/70 bg-surface px-3 py-2">
          <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" aria-hidden />
          <span>Supervisor URL + token powers LinkedIn Browser Computer seats (isolated Chromium).</span>
        </li>
      </ul>
    </div>
  );
}
