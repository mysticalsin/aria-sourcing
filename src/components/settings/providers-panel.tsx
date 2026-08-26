"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Select,
  Switch,
  useConfirm,
  useToast,
} from "@/components/ui";
import {
  useActions,
  useApiKeys,
  useLlmProviders,
  useRole,
} from "@/lib/store";
import {
  LLM_PROVIDERS,
  type ApiKey,
  type ApiKeyProvider,
  type LlmProvider,
  type LlmProviderKind,
} from "@/lib/types";
import { can } from "@/lib/rbac";
import { formatTimeAgo, type Tone } from "@/lib/utils";
import {
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  Zap,
} from "lucide-react";

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

const STATUS_TONE: Record<ApiKey["status"], Tone> = {
  valid: "success",
  invalid: "danger",
  untested: "neutral",
};

/** Map LLM provider kind → vault api_keys.provider label. */
export function vaultProviderForKind(kind: LlmProviderKind): ApiKeyProvider {
  if (kind === "Kimi") return "Kimi (Moonshot)";
  if (kind === "Local/Custom") return "Custom";
  return kind as ApiKeyProvider;
}

function kindFromVaultProvider(provider: ApiKeyProvider): LlmProviderKind | null {
  if (provider === "Kimi (Moonshot)") return "Kimi";
  if (provider === "Custom") return "Local/Custom";
  if ((LLM_PROVIDERS as readonly string[]).includes(provider)) {
    return provider as LlmProviderKind;
  }
  return null;
}

/** Providers that support a live end-to-end probe (preferred in the add form). */
const LIVE_VERIFY_PROVIDERS: ApiKeyProvider[] = [
  "Anthropic",
  "OpenAI",
  "Groq",
  "xAI",
  "Mistral",
  "Kimi (Moonshot)",
];

const LLM_VAULT_PROVIDERS: ApiKeyProvider[] = [
  ...LIVE_VERIFY_PROVIDERS,
  "Google",
  "OpenRouter",
  "Custom",
];

function isLlmVaultProvider(provider: ApiKeyProvider): boolean {
  return LLM_VAULT_PROVIDERS.includes(provider);
}

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
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${PROVIDER_COLOR[provider.kind]}`}
        >
          <Cpu className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">{provider.label}</span>
            <Badge tone="neutral" size="sm">
              {provider.kind}
            </Badge>
            {provider.isDefault && (
              <Badge tone="electric" size="sm">
                <Star className="h-2.5 w-2.5" /> default
              </Badge>
            )}
          </div>

          {isAdmin && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Base URL (optional)"
                htmlFor={`baseUrl-${provider.id}`}
                hint="Leave blank to use the provider's default endpoint."
              >
                <Input
                  id={`baseUrl-${provider.id}`}
                  value={provider.baseUrl ?? ""}
                  onChange={(e) => onUpdate({ baseUrl: e.target.value || undefined })}
                  placeholder="https://api.example.com/v1"
                />
              </Field>
              <Field
                label="Linked key"
                htmlFor={`apiKey-${provider.id}`}
                hint="Encrypted vault keys for this provider (••••last4 only)."
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
                        testingId === provider.apiKeyId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )
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
  const confirm = useConfirm();

  const [newKind, setNewKind] = React.useState<LlmProviderKind>("Anthropic");
  const [newLabel, setNewLabel] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const [keyProvider, setKeyProvider] = React.useState<ApiKeyProvider>("Anthropic");
  const [keyName, setKeyName] = React.useState("");
  const [keyValue, setKeyValue] = React.useState("");
  const [keyBusy, setKeyBusy] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [lastSavedLast4, setLastSavedLast4] = React.useState<string | null>(null);

  const llmKeys = React.useMemo(
    () => apiKeys.filter((k) => isLlmVaultProvider(k.provider)),
    [apiKeys],
  );

  function keysForKind(kind: LlmProviderKind) {
    const vault = vaultProviderForKind(kind);
    return apiKeys
      .filter((k) => k.provider === vault)
      .map((k) => ({
        value: k.id,
        label: `${k.name} (••••${k.last4}${
          k.status === "valid"
            ? " · verified"
            : k.status === "invalid"
              ? " · invalid"
              : " · untested"
        })`,
      }));
  }

  function wireProviderToKey(provider: ApiKeyProvider, keyId: string) {
    const kind = kindFromVaultProvider(provider);
    if (!kind) return;
    const existing = providers.find((p) => p.kind === kind);
    if (existing) {
      actions.updateProvider(existing.id, {
        apiKeyId: keyId,
        enabled: true,
      });
      return;
    }
    actions.addProvider({
      kind,
      label: kind,
      enabled: true,
      apiKeyId: keyId,
      isDefault: providers.length === 0,
    });
  }

  async function handleVerifyKey(keyId: string) {
    setTestingId(keyId);
    const r = await actions.testApiKey(keyId);
    setTestingId(null);
    const live = /accepted \(HTTP|authenticated \(HTTP|rejected this key/i.test(r.detail ?? "");
    toast({
      title: r.valid
        ? live
          ? "Key works end-to-end"
          : "Format looks valid"
        : live
          ? "Provider rejected this key"
          : "Verification failed",
      description: r.detail,
      variant: r.valid ? "success" : "error",
    });
  }

  async function handleSaveAndVerifyKey() {
    if (!keyValue.trim()) {
      toast({ title: "Paste an API key first", variant: "warning" });
      return;
    }
    const label =
      keyName.trim() ||
      `${keyProvider} ${new Date().toISOString().slice(0, 10)}`;
    setKeyBusy(true);
    setLastSavedLast4(null);
    const saved = await actions.saveApiKey({
      name: label,
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
    setLastSavedLast4(saved.key.last4);
    const keyId = saved.key.id;

    // Prefer the encrypt-time probe returned by POST /api/keys; fall back to
    // a separate /api/keys/test when the save response omitted verification.
    let valid = saved.valid === true;
    let detail = saved.detail ?? "";
    if (saved.valid === undefined) {
      const tested = await actions.testApiKey(keyId);
      valid = tested.valid;
      detail = tested.detail;
    }

    setKeyBusy(false);
    if (valid) {
      wireProviderToKey(keyProvider, keyId);
      toast({
        title: "Encrypted and verified end-to-end",
        description: `Stored as ••••${saved.key.last4}. ${detail}`,
        variant: "success",
      });
      setKeyName("");
    } else {
      toast({
        title: "Encrypted, but live verification failed",
        description: `${detail || "Provider rejected this key."} Delete the key below and try again with a working secret.`,
        variant: "error",
      });
    }
  }

  async function handleRemoveKey(id: string, label: string) {
    if (
      !(await confirm({
        title: `Delete API key "${label}"?`,
        description: "Removes the encrypted secret from the vault. Linked providers will lose this key.",
        confirmLabel: "Delete",
        danger: true,
      }))
    ) {
      return;
    }
    const res = await actions.removeApiKey(id);
    if (!res.ok) {
      toast({ title: "Couldn't delete API key", description: res.error, variant: "error" });
      return;
    }
    // Unlink from any provider rows that pointed at it.
    for (const p of providers) {
      if (p.apiKeyId === id) actions.updateProvider(p.id, { apiKeyId: undefined });
    }
    toast({ title: "API key deleted", variant: "info" });
  }

  function handleAdd() {
    const label = newLabel.trim() || newKind;
    actions.addProvider({ kind: newKind, label, enabled: false });
    toast({ title: `Provider added: ${label}`, variant: "success" });
    setNewLabel("");
    setAdding(false);
  }

  const liveHint = LIVE_VERIFY_PROVIDERS.includes(keyProvider)
    ? "We call the provider’s API with your key (models list) to prove it works. The raw secret is never shown again."
    : "This provider is format-checked only (no live probe yet). Prefer Anthropic or OpenAI for full end-to-end verification.";

  return (
    <Card>
      <CardContent className="space-y-6">
        {/* ---- Primary: simple add key ------------------------------------ */}
        {canManageKeys ? (
          <div className="rounded-2xl border border-electric/20 bg-electric/[0.04] p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-electric-soft text-electric">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-base font-bold text-ink">Add an API key</p>
                <p className="mt-1 text-sm text-muted">
                  Paste once → we encrypt it server-side → we verify it live with the provider →
                  you only ever see <span className="font-semibold text-ink">••••last4</span>.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider" htmlFor="ai-key-provider">
                <Select
                  id="ai-key-provider"
                  value={keyProvider}
                  onChange={(e) => setKeyProvider(e.target.value as ApiKeyProvider)}
                  options={LLM_VAULT_PROVIDERS.map((p) => ({
                    value: p,
                    label: LIVE_VERIFY_PROVIDERS.includes(p) ? `${p} · live verify` : p,
                  }))}
                />
              </Field>
              <Field
                label="Label (optional)"
                htmlFor="ai-key-name"
                hint="Defaults to provider + date if blank."
              >
                <Input
                  id="ai-key-name"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="e.g. Anthropic production"
                />
              </Field>
              <Field
                label="API key"
                htmlFor="ai-key-value"
                hint={liveHint}
                className="sm:col-span-2"
              >
                <Input
                  id="ai-key-value"
                  type="password"
                  autoComplete="off"
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  placeholder={
                    keyProvider === "Anthropic"
                      ? "sk-ant-…"
                      : keyProvider === "OpenAI"
                        ? "sk-… or sk-proj-…"
                        : "Paste secret key"
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !keyBusy) void handleSaveAndVerifyKey();
                  }}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button
                  leftIcon={
                    keyBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )
                  }
                  disabled={keyBusy || !keyValue.trim()}
                  onClick={() => void handleSaveAndVerifyKey()}
                >
                  {keyBusy ? "Encrypting & verifying…" : "Add key"}
                </Button>
                {lastSavedLast4 ? (
                  <p className="text-sm text-muted">
                    Last saved secret ends in{" "}
                    <span className="font-semibold tabular-nums text-ink">••••{lastSavedLast4}</span>
                    {" "}— full key is not available in the browser.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-[hsl(32_90%_34%)]">
            Admins only. Ask a workspace admin to add and verify LLM API keys.
          </p>
        )}

        {/* ---- Saved encrypted keys --------------------------------------- */}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-ink">Saved keys</p>
            <p className="text-xs text-muted">
              Encrypted at rest. Only the last four characters are visible.
            </p>
          </div>
          {llmKeys.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              No LLM keys yet. Add one above — Anthropic and OpenAI are verified live.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {llmKeys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 p-3.5">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink/[0.05] text-ink-soft"
                    aria-hidden
                  >
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{k.name}</span>
                    <span className="block text-xs text-muted">
                      {k.provider} · ••••{k.last4}
                      {k.lastTestedAt ? ` · tested ${formatTimeAgo(k.lastTestedAt)}` : ""}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[k.status]} size="sm">
                    {k.status === "valid"
                      ? "verified"
                      : k.status === "invalid"
                        ? "invalid"
                        : "untested"}
                  </Badge>
                  {canManageKeys && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testingId === k.id}
                        leftIcon={
                          testingId === k.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Zap className="h-3.5 w-3.5" />
                          )
                        }
                        onClick={() => void handleVerifyKey(k.id)}
                      >
                        Verify
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${k.name}`}
                        onClick={() => void handleRemoveKey(k.id, k.name)}
                      >
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- Provider rows ---------------------------------------------- */}
        <div className="space-y-3 border-t border-line pt-5">
          <div>
            <p className="text-sm font-semibold text-ink">Providers</p>
            <p className="text-xs text-muted">
              Enable a backend and link a verified key. Adding a key above auto-wires a matching
              provider when possible.
            </p>
          </div>

          {providers.length === 0 && (
            <p className="text-sm text-muted">
              No LLM providers configured yet. Add a verified key above or add a provider manually.
            </p>
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

          {isAdmin && (
            <div className="pt-2">
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
                    <Button size="sm" onClick={handleAdd}>
                      Add provider
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                      Cancel
                    </Button>
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
        </div>
      </CardContent>
    </Card>
  );
}
