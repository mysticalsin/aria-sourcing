"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Field, Input, Select, EmptyState, useToast, useConfirm } from "@/components/ui";
import { useActions, useApiKeys, useRole } from "@/lib/store";
import { API_KEY_PROVIDERS, type ApiKeyProvider } from "@/lib/types";
import { can } from "@/lib/rbac";
import { experimentalPaidSourcingEnabled } from "@/lib/supabase/config";
import { formatTimeAgo, type Tone } from "@/lib/utils";
import { KeyRound, Plus, ShieldAlert, Trash2, Zap } from "lucide-react";

const STATUS_TONE: Record<string, Tone> = { valid: "success", invalid: "danger", untested: "neutral" };

const SELECTABLE_API_KEY_PROVIDERS = experimentalPaidSourcingEnabled
  ? API_KEY_PROVIDERS
  : API_KEY_PROVIDERS.filter((provider) => provider !== "Sillage" && provider !== "Seamless");

// Provider-specific format hints for the API key value field. Most providers
// rely on the generic placeholder below; the LinkedIn profile search connector
// token shape is distinctive enough to call out explicitly.
const KEY_VALUE_HINT: Partial<Record<ApiKeyProvider, string>> = {
  Apify:
    "LinkedIn profile search connector token (from your search-provider console), format apify_api_…",
};
const KEY_VALUE_PLACEHOLDER: Partial<Record<ApiKeyProvider, string>> = {
  Apify: "apify_api_…  (stored server-side, never shown again)",
  DeepSeek: "sk-…  (encrypted; never shown again)",
  "NVIDIA NIM": "nvapi-…  (encrypted; never shown again)",
  "Kimi (Moonshot)": "sk-…  (Moonshot / Kimi; encrypted)",
};

const KEY_PROVIDER_LABELS: Partial<Record<ApiKeyProvider, string>> = {
  Apify: "LinkedIn profile search",
  "Kimi (Moonshot)": "Kimi (Moonshot)",
  "NVIDIA NIM": "NVIDIA NIM",
  DeepSeek: "DeepSeek",
};

export function ApiKeysPanel() {
  const keys = useApiKeys();
  const role = useRole();
  const actions = useActions();
  const { toast } = useToast();
  const confirm = useConfirm();
  const isAdmin = can(role, "manage_keys");

  const [name, setName] = React.useState("");
  const [provider, setProvider] = React.useState<ApiKeyProvider>("Anthropic");
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState<string | null>(null);

  async function handleSave() {
    if (!value.trim()) {
      toast({ title: "Paste an API key first", variant: "warning" });
      return;
    }
    const label =
      name.trim() || `${provider} ${new Date().toISOString().slice(0, 10)}`;
    setBusy(true);
    const res = await actions.saveApiKey({ name: label, provider, value });
    if (!res.ok || !res.key) {
      setBusy(false);
      toast({ title: "Could not save key", description: res.error, variant: "error" });
      return;
    }
    setName("");
    setValue(""); // never retain the secret in the form after encrypt/store

    let valid = res.valid === true;
    let detail = res.detail ?? "";
    if (res.valid === undefined) {
      const tested = await actions.testApiKey(res.key.id);
      valid = tested.valid;
      detail = tested.detail;
    }
    setBusy(false);
    toast({
      title: valid
        ? "Encrypted and verified end-to-end"
        : "Encrypted, but live verification failed",
      description: valid
        ? `Stored as ••••${res.key.last4}. ${detail}`
        : `${detail || "Provider rejected this key."} Delete the key below and try again with a working secret.`,
      variant: valid ? "success" : "error",
    });
  }

  async function handleTest(id: string) {
    setTesting(id);
    const r = await actions.testApiKey(id);
    setTesting(null);
    const live = /accepted \(HTTP|authenticated \(HTTP|rejected this key/i.test(r.detail ?? "");
    toast({
      title: r.valid
        ? live
          ? "Key verified with provider"
          : "Format looks valid"
        : live
          ? "Key verification failed"
          : "Format check failed",
      description: r.detail,
      variant: r.valid ? "success" : "error",
    });
  }

  async function handleRemove(id: string, label: string) {
    if (!(await confirm({ title: `Delete API key "${label}"?`, description: "This removes it from the backend.", confirmLabel: "Delete", danger: true }))) return;
    const res = await actions.removeApiKey(id);
    if (!res.ok) {
      toast({ title: "Couldn't delete API key", description: res.error, variant: "error" });
      return;
    }
    toast({ title: "API key deleted", variant: "info" });
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        {!isAdmin && (
          <div className="flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-[hsl(32_90%_34%)]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            API keys are managed by admins. You can see what's configured, but not add, test, or delete.
          </div>
        )}

        {isAdmin && (
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Label (optional)" htmlFor="key-name" hint="Defaults to provider + date if blank.">
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anthropic (primary)" />
            </Field>
            <Field label="Provider" htmlFor="key-provider">
              <Select
                id="key-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ApiKeyProvider)}
                options={SELECTABLE_API_KEY_PROVIDERS.map((p) => ({
                  value: p,
                  label: KEY_PROVIDER_LABELS[p] ?? p,
                }))}
              />
            </Field>
            <Field
              label="API key"
              htmlFor="key-value"
              hint={
                KEY_VALUE_HINT[provider] ??
                "Paste once → we encrypt server-side → we verify live → you only see ••••last4."
              }
              className="sm:col-span-3"
            >
              <div className="flex gap-2">
                <Input
                  id="key-value"
                  type="password"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={KEY_VALUE_PLACEHOLDER[provider] ?? "sk-…  (encrypted; never shown again)"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) void handleSave();
                  }}
                />
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={busy || !value.trim()}
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => void handleSave()}
                >
                  {busy ? "Encrypting…" : "Add key"}
                </Button>
              </div>
            </Field>
          </div>
        )}

        {keys.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-6 w-6" />}
            title="No API keys yet"
            description={isAdmin ? "Add a provider key above. The secret is stored server-side and only the last 4 are ever shown." : "No keys configured."}
          />
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 p-3.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink/[0.05] text-ink-soft" aria-hidden>
                  <KeyRound className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{k.name}</span>
                  <span className="block text-xs text-muted">
                    {KEY_PROVIDER_LABELS[k.provider] ?? k.provider} · ••••{k.last4}
                    {k.lastTestedAt ? ` · tested ${formatTimeAgo(k.lastTestedAt)}` : ""}
                  </span>
                </span>
                <Badge tone={STATUS_TONE[k.status] ?? "neutral"} size="sm">
                  {k.status}
                </Badge>
                {isAdmin && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      loading={testing === k.id}
                      leftIcon={<Zap className="h-4 w-4" />}
                      onClick={() => handleTest(k.id)}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${k.name}`}
                      onClick={() => handleRemove(k.id, k.name)}
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          Secrets are written encrypted to the backend and withheld from the browser (only the last 4
          digits are returned). LLM and sourcing connector keys are verified with a live provider
          probe. Admins only.
        </p>
      </CardContent>
    </Card>
  );
}
