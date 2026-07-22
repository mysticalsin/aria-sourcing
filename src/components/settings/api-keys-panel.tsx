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
// rely on the generic placeholder below; Apify's token shape is distinctive
// enough (and easy to confuse with a project/actor id) to call out explicitly.
const KEY_VALUE_HINT: Partial<Record<ApiKeyProvider, string>> = {
  Apify: "Personal API token from the Apify console (Settings → Integrations), format apify_api_…",
};
const KEY_VALUE_PLACEHOLDER: Partial<Record<ApiKeyProvider, string>> = {
  Apify: "apify_api_…  (stored server-side, never shown again)",
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
    if (!name.trim() || !value.trim()) {
      toast({ title: "Name and key required", variant: "warning" });
      return;
    }
    setBusy(true);
    const res = await actions.saveApiKey({ name: name.trim(), provider, value });
    setBusy(false);
    if (res.ok) {
      setName("");
      setValue(""); // never retain the secret in the form
      toast({
        title: "API key saved",
        description: res.demo
          ? "Stored for this session (demo). Configure Supabase to persist server-side."
          : "Stored securely in the backend. Test it below.",
        variant: "success",
      });
    } else {
      toast({ title: "Could not save key", description: res.error, variant: "error" });
    }
  }

  async function handleTest(id: string) {
    setTesting(id);
    const r = await actions.testApiKey(id);
    setTesting(null);
    toast({
      title: !r.ok
        ? "Credential test could not complete"
        : r.valid
          ? "Provider credential verified"
          : r.status === "untested"
            ? "Live verification unavailable"
            : "Provider rejected the credential",
      description: r.detail,
      variant: !r.ok ? "error" : r.valid ? "success" : r.status === "untested" ? "warning" : "error",
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
            <Field label="Label" htmlFor="key-name">
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anthropic (primary)" />
            </Field>
            <Field label="Provider" htmlFor="key-provider">
              <Select
                id="key-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ApiKeyProvider)}
                options={SELECTABLE_API_KEY_PROVIDERS.map((p) => ({ value: p, label: p }))}
              />
            </Field>
            <Field
              label="API key"
              htmlFor="key-value"
              hint={KEY_VALUE_HINT[provider]}
              className="sm:col-span-3"
            >
              <div className="flex gap-2">
                <Input
                  id="key-value"
                  type="password"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={KEY_VALUE_PLACEHOLDER[provider] ?? "sk-…  (stored server-side, never shown again)"}
                />
                <Button variant="secondary" loading={busy} leftIcon={<Plus className="h-4 w-4" />} onClick={handleSave}>
                  Save key
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
                    {k.provider} · ••••{k.last4}
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
                      Test key
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
          Secrets are written to the backend and withheld from the browser (only the last 4 digits are
          returned). Validation runs server-side. Admins only.
        </p>
      </CardContent>
    </Card>
  );
}
