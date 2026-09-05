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
 * Primary Automatic path = OpenBot Browser Computer (sandbox/VM supervisor).
 * Vendor API and LinkedIn OIDC are optional / advanced — not required to send.
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
          Admins attach the OpenBot computer-supervisor URL and token in Aria Settings. LinkedIn
          OIDC / Vendor API are optional.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 border-b border-line/60 px-6 py-5 sm:px-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          OpenBot Browser Computer (primary)
        </p>
        <p className="mt-1 text-sm text-ink">
          Automatic LinkedIn outreach runs inside the{" "}
          <span className="font-medium">sandbox / VM OpenBot creates</span> — not through LinkedIn’s
          OIDC or Vendor APIs. Point Aria at your computer supervisor, create a Browser Computer
          seat, then log in to LinkedIn once via Fleet → Observe / Take control.
        </p>
      </div>

      <div className="rounded-xl border border-electric/25 bg-electric/5 px-3 py-3 text-xs text-muted">
        <p className="font-medium text-ink-soft">How to connect OpenBot</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>
            Run or open your OpenBot computer supervisor (isolated Chromium seats). Copy its base
            URL and bearer token.
          </li>
          <li>
            In Aria → <span className="font-medium text-ink-soft">API keys</span>, add the token with
            provider{" "}
            <span className="font-medium text-ink-soft">{COMPUTER_SUPERVISOR_VAULT_PROVIDER}</span>.
          </li>
          <li>Paste the supervisor URL below and attach that vault key.</li>
          <li>
            In LinkedIn connections, create a{" "}
            <span className="font-medium text-ink-soft">Browser Computer</span> seat, then open Fleet
            → Computers → Observe / Take control to complete LinkedIn login / 2FA inside the sandbox.
          </li>
        </ol>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="1. OpenBot supervisor URL"
          htmlFor="computerSupervisorUrl"
          hint="Base URL of the OpenBot computer supervisor that spawns sandbox/VM Chromium seats."
        >
          <Input
            id="computerSupervisorUrl"
            value={settings.computerSupervisorUrl ?? ""}
            onChange={(e) => actions.updateSettings({ computerSupervisorUrl: e.target.value })}
            onBlur={(e) => patch({ computerSupervisorUrl: e.target.value })}
            placeholder="https://computers.your-openbot-host.example"
            autoComplete="off"
          />
        </Field>
        <Field
          label="1. OpenBot supervisor token"
          htmlFor="computerSupervisorTokenKeyId"
          hint={`API keys provider “${COMPUTER_SUPERVISOR_VAULT_PROVIDER}”.`}
        >
          <Select
            id="computerSupervisorTokenKeyId"
            value={settings.computerSupervisorTokenKeyId ?? ""}
            onChange={(e) => patch({ computerSupervisorTokenKeyId: e.target.value })}
            options={keyOptions(supervisorKeys, "None yet — add under API keys first")}
          />
        </Field>
      </div>

      <details className="rounded-xl border border-line/70 bg-surface px-3 py-3 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-ink-soft">
          Advanced — optional LinkedIn OIDC / Vendor API (not used for OpenBot send)
        </summary>
        <p className="mt-2">
          Skip these unless you still need Sign-in-with-LinkedIn identity badges or a contracted
          vendor messaging API. OpenBot send does not call LinkedIn OIDC or Vendor endpoints.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field
            label="OIDC Client ID (optional)"
            htmlFor="linkedinClientId"
            hint="Only if you want Sign in with LinkedIn for identity display."
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
            label="OIDC Client Secret (optional)"
            htmlFor="linkedinClientSecretKeyId"
            hint={`API keys provider “${LINKEDIN_OIDC_VAULT_PROVIDER}”.`}
          >
            <Select
              id="linkedinClientSecretKeyId"
              value={settings.linkedinClientSecretKeyId ?? ""}
              onChange={(e) => patch({ linkedinClientSecretKeyId: e.target.value })}
              options={keyOptions(oidcKeys, "None — skip if unused")}
            />
          </Field>

          <Field
            label="Vendor send URL (optional)"
            htmlFor="linkedinVendorApiUrl"
            hint="Legacy contracted messaging vendor. Prefer OpenBot Browser Computer."
          >
            <Input
              id="linkedinVendorApiUrl"
              value={settings.linkedinVendorApiUrl ?? ""}
              onChange={(e) => actions.updateSettings({ linkedinVendorApiUrl: e.target.value })}
              onBlur={(e) => patch({ linkedinVendorApiUrl: e.target.value })}
              placeholder="https://api.your-vendor.com/v1/messages"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Vendor API key (optional)"
            htmlFor="linkedinVendorApiKeyId"
            hint={`API keys provider “${LINKEDIN_VENDOR_VAULT_PROVIDER}”.`}
          >
            <Select
              id="linkedinVendorApiKeyId"
              value={settings.linkedinVendorApiKeyId ?? ""}
              onChange={(e) => patch({ linkedinVendorApiKeyId: e.target.value })}
              options={keyOptions(vendorKeys, "None — skip if unused")}
            />
          </Field>
        </div>
      </details>

      <ul className="grid gap-2 text-xs text-muted sm:grid-cols-3">
        <li className="flex items-start gap-2 rounded-xl border border-line/70 bg-surface px-3 py-2">
          <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" aria-hidden />
          <span>
            <span className="font-medium text-ink-soft">Primary:</span> OpenBot supervisor URL + token
            so Aria can dispatch sends into the sandbox/VM.
          </span>
        </li>
        <li className="flex items-start gap-2 rounded-xl border border-line/70 bg-surface px-3 py-2">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" aria-hidden />
          <span>
            Secrets go in <span className="font-medium text-ink-soft">API keys</span> first, then
            attach here — Aria never stores the raw secret in Settings JSON.
          </span>
        </li>
        <li className="flex items-start gap-2 rounded-xl border border-line/70 bg-surface px-3 py-2">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" aria-hidden />
          <span>
            Login happens inside the OpenBot seat (Fleet Observe), not via LinkedIn OIDC for send.
          </span>
        </li>
      </ul>
    </div>
  );
}
