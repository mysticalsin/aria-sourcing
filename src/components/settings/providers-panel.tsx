"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Field, Input, Select, Switch, useToast } from "@/components/ui";
import {
  useActions,
  useApiKeys,
  useLlmProviders,
  useRole,
} from "@/lib/store";
import {
  LLM_PROVIDERS,
  type ApiKeyProvider,
  type LlmProvider,
  type LlmProviderKind,
} from "@/lib/types";
import { can } from "@/lib/rbac";
import { CheckCircle2, Cpu, KeyRound, Loader2, Plus, Star, Trash2 } from "lucide-react";

/* ---- helpers ------------------------------------------------------------- */

const PROVIDER_COLOR: Record<LlmProviderKind, string> = {
  Anthropic: "bg-violet-100 text-violet-700",
  OpenAI: "bg-green-100 text-green-700",
  OpenRouter: "bg-sky-100 text-sky-700",
  Google: "bg-blue-100 text-blue-700",
  xAI: "bg-slate-100 text-slate-700",
  Groq: "bg-orange-100 text-orange-700",
  Mistral: "bg-rose-100 text-rose-700",
  Kimi: "bg-indigo-100 text-indigo-700",
  "Local/Custom": "bg-neutral-100 text-neutral-600",
};

/** Map LLM provider kind → vault api_keys.provider label. */
export function vaultProviderForKind(kind: LlmProviderKind): ApiKeyProvider {
  if (kind === "Kimi") return "Kimi (Moonshot)";
  if (kind === "Local/Custom") return "Custom";
  return kind as ApiKeyProvider;
}

const LLM_VAULT_PROVIDERS: ApiKeyProvider[] = [
  "Anthropic",
  "OpenAI",
  "Google",
  "xAI",
  "Groq",
  "OpenRouter",
  "Mistral",
  "Kimi (Moonshot)",
  "Custom",
];

/* ---- ProviderRow --------------------------------------------------------- */

function ProviderRow({
  provider,
  apiKeyOptions,
  isAdmin,
  canManageKeys,
  testingId,
  onUpdate,
  onRemove,
  onSetDefault,
  onTestKey,
}: {
  provider: LlmProvider;
  apiKeyOptions: { value: string; label: string }[];
  isAdmin: boolean;
  canManageKeys: boolean;
  testingId: string | null;
  onUpdate: (patch: Partial<LlmProvider>) => void;
  onRemove: () => void;
  onSetDefault: () => void;
  onTestKey: (keyId: string) => void;
}) {
  const linked = provider.apiKeyId
    ? apiKeyOptions.find((o) => o.value === provider.apiKeyId)
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex items-start gap-3 sm:flex-1">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${PROVIDER_COLOR[provider.kind]}`}>
          <Cpu className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">{provider.label}</span>
            <Badge tone="neutral" size="sm">{provider.kind}</Badge>
            {provider.isDefault && (
              <Badge tone="electric" size="sm">
                <Star className="h-2.5 w-2.5" /> default
              </Badge>
            )}
          </div>

          {isAdmin && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Base URL (optional)" htmlFor={`baseUrl-${provider.id}`} hint="Leave blank to use the provider's default endpoint.">
                <Input
                  id={`baseUrl-${provider.id}`}
                  value={provider.baseUrl ?? ""}
                  onChange={(e) => onUpdate({ baseUrl: e.target.value || undefined })}
                  placeholder="https://api.example.com/v1"
                />
              </Field>
              <Field
                label="API key"
                htmlFor={`apiKey-${provider.id}`}
                hint="Select a saved key for this provider (or add one below)."
              >
                <div className="flex gap-2">
                  <Select
                    id={`apiKey-${provider.id}`}
                    value={provider.apiKeyId ?? ""}
                    onChange={(e) => onUpdate({ apiKeyId: e.target.value || undefined })}
                    options={[{ value: "", label: "(none)" }, ...apiKeyOptions]}
                    className="min-w-0 flex-1"
                  />
                  {canManageKeys && provider.apiKeyId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={testingId === provider.apiKeyId}
                      leftIcon={
                        testingId === provider.apiKeyId
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <CheckCircle2 className="h-3.5 w-3.5" />
                      }
                      onClick={() => onTestKey(provider.apiKeyId!)}
                      title={linked ? `Verify ${linked.label}` : "Verify linked key"}
                    >
                      Verify
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Switch
          id={`enable-${provider.id}`}
          checked={provider.enabled}
          onCheckedChange={(v) => onUpdate({ enabled: v })}
          label={provider.enabled ? "Enabled" : "Disabled"}
          disabled={!isAdmin}
        />
        {isAdmin && !provider.isDefault && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Star className="h-3.5 w-3.5" />}
            onClick={onSetDefault}
            title="Set as default provider"
          >
            Set default
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={onRemove}
            title="Remove provider"
          />
        )}
      </div>
    </div>
  );
}

/* ---- ProvidersPanel ------------------------------------------------------ */

export function ProvidersPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_providers");
  const canManageKeys = can(role, "manage_keys");
  const providers = useLlmProviders();
  const apiKeys = useApiKeys();
  const actions = useActions();
  const { toast } = useToast();

  const [newKind, setNewKind] = React.useState<LlmProviderKind>("Anthropic");
  const [newLabel, setNewLabel] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const [keyProvider, setKeyProvider] = React.useState<ApiKeyProvider>("Anthropic");
  const [keyName, setKeyName] = React.useState("");
  const [keyValue, setKeyValue] = React.useState("");
  const [keyBusy, setKeyBusy] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [showKeyForm, setShowKeyForm] = React.useState(false);

  function keysForKind(kind: LlmProviderKind) {
    const vault = vaultProviderForKind(kind);
    return apiKeys
      .filter((k) => k.provider === vault)
      .map((k) => ({
        value: k.id,
        label: `${k.name} (••••${k.last4}${k.status === "valid" ? " · verified" : k.status === "invalid" ? " · invalid" : " · untested"})`,
      }));
  }

  async function handleVerifyKey(keyId: string) {
    setTestingId(keyId);
    const r = await actions.testApiKey(keyId);
    setTestingId(null);
    toast({
      title: r.valid ? "Key verified with provider" : "Key verification failed",
      description: r.detail,
      variant: r.valid ? "success" : "error",
    });
  }

  async function handleSaveAndVerifyKey() {
    if (!keyName.trim() || !keyValue.trim()) {
      toast({ title: "Name and key required", variant: "warning" });
      return;
    }
    setKeyBusy(true);
    const saved = await actions.saveApiKey({
      name: keyName.trim(),
      provider: keyProvider,
      value: keyValue,
    });
    if (!saved.ok || !saved.key) {
      setKeyBusy(false);
      toast({ title: "Could not save key", description: saved.error, variant: "error" });
      return;
    }
    // Clear secret from the form immediately — never retain after encrypt/store.
    setKeyValue("");
    const keyId = saved.key.id;
    const tested = await actions.testApiKey(keyId);
    setKeyBusy(false);
    if (tested.valid) {
      // Auto-link to a matching provider row that has no key yet.
      const kindMatch = providers.find(
        (p) => vaultProviderForKind(p.kind) === keyProvider && !p.apiKeyId,
      );
      if (kindMatch) {
        actions.updateProvider(kindMatch.id, { apiKeyId: keyId, enabled: true });
      }
      toast({
        title: "Key encrypted and verified",
        description: tested.detail,
        variant: "success",
      });
      setKeyName("");
      setShowKeyForm(false);
    } else {
      toast({
        title: "Key saved but verification failed",
        description: tested.detail,
        variant: "error",
      });
    }
  }

  function handleAdd() {
    const label = newLabel.trim() || newKind;
    actions.addProvider({ kind: newKind, label, enabled: false });
    toast({ title: `Provider added: ${label}`, variant: "success" });
    setNewLabel("");
    setAdding(false);
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        {providers.length === 0 && (
          <p className="text-sm text-muted">No LLM providers configured. Add one below.</p>
        )}

        <div className="space-y-3">
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              apiKeyOptions={keysForKind(p.kind)}
              isAdmin={isAdmin}
              canManageKeys={canManageKeys}
              testingId={testingId}
              onUpdate={(patch) => actions.updateProvider(p.id, patch)}
              onRemove={() => {
                actions.removeProvider(p.id);
                toast({ title: "Provider removed", variant: "info" });
              }}
              onSetDefault={() => {
                actions.setDefaultProvider(p.id);
                toast({ title: `${p.label} set as default provider`, variant: "success" });
              }}
              onTestKey={handleVerifyKey}
            />
          ))}
        </div>

        {canManageKeys && (
          <div className="rounded-2xl border border-dashed border-line bg-canvas/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">Add & verify LLM API key</p>
                <p className="text-xs text-muted">
                  Secret is encrypted at rest. We call the provider to confirm the key works, then mark it verified for Aria.
                </p>
              </div>
              {!showKeyForm && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<KeyRound className="h-4 w-4" />}
                  onClick={() => setShowKeyForm(true)}
                >
                  Add key
                </Button>
              )}
            </div>
            {showKeyForm && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Label" htmlFor="ai-key-name">
                  <Input
                    id="ai-key-name"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="e.g. Anthropic production"
                  />
                </Field>
                <Field label="Provider" htmlFor="ai-key-provider">
                  <Select
                    id="ai-key-provider"
                    value={keyProvider}
                    onChange={(e) => setKeyProvider(e.target.value as ApiKeyProvider)}
                    options={LLM_VAULT_PROVIDERS.map((p) => ({ value: p, label: p }))}
                  />
                </Field>
                <Field
                  label="API key"
                  htmlFor="ai-key-value"
                  hint="Stored encrypted server-side — never shown again."
                  className="sm:col-span-2"
                >
                  <Input
                    id="ai-key-value"
                    type="password"
                    autoComplete="off"
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    placeholder="Paste secret key"
                  />
                </Field>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Button
                    size="sm"
                    leftIcon={
                      keyBusy
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <CheckCircle2 className="h-3.5 w-3.5" />
                    }
                    disabled={keyBusy}
                    onClick={() => void handleSaveAndVerifyKey()}
                  >
                    {keyBusy ? "Encrypting & verifying…" : "Save, encrypt & verify"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={keyBusy}
                    onClick={() => {
                      setShowKeyForm(false);
                      setKeyValue("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="border-t border-line pt-4">
            {adding ? (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Kind" htmlFor="new-prov-kind" className="min-w-[160px]">
                  <Select
                    id="new-prov-kind"
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as LlmProviderKind)}
                    options={LLM_PROVIDERS.map((k) => ({ value: k, label: k }))}
                  />
                </Field>
                <Field label="Label (optional)" htmlFor="new-prov-label" className="min-w-[200px]">
                  <Input
                    id="new-prov-label"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={newKind}
                  />
                </Field>
                <div className="flex gap-2 pb-1">
                  <Button size="sm" onClick={handleAdd}>Add provider</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setAdding(true)}
              >
                Add provider
              </Button>
            )}
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted">Admins only. Contact your workspace admin to configure LLM providers.</p>
        )}
      </CardContent>
    </Card>
  );
}
