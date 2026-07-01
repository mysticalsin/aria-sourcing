"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Field, Input, Select, Switch, useToast } from "@/components/ui";
import {
  useActions,
  useApiKeys,
  useLlmProviders,
  useRole,
} from "@/lib/store";
import { LLM_PROVIDERS, type LlmProvider, type LlmProviderKind } from "@/lib/types";
import { can } from "@/lib/rbac";
import { Cpu, Plus, Star, Trash2 } from "lucide-react";

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

/* ---- ProviderRow --------------------------------------------------------- */

function ProviderRow({
  provider,
  apiKeyOptions,
  isAdmin,
  onUpdate,
  onRemove,
  onSetDefault,
}: {
  provider: LlmProvider;
  apiKeyOptions: { value: string; label: string }[];
  isAdmin: boolean;
  onUpdate: (patch: Partial<LlmProvider>) => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
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
              <Field label="API key" htmlFor={`apiKey-${provider.id}`} hint="Select a saved key for this provider.">
                <Select
                  id={`apiKey-${provider.id}`}
                  value={provider.apiKeyId ?? ""}
                  onChange={(e) => onUpdate({ apiKeyId: e.target.value || undefined })}
                  options={[{ value: "", label: "(none)" }, ...apiKeyOptions]}
                />
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
  const providers = useLlmProviders();
  const apiKeys = useApiKeys();
  const actions = useActions();
  const { toast } = useToast();

  const [newKind, setNewKind] = React.useState<LlmProviderKind>("Anthropic");
  const [newLabel, setNewLabel] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const apiKeyOptions = apiKeys.map((k) => ({ value: k.id, label: `${k.name} (••••${k.last4})` }));

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
              apiKeyOptions={apiKeyOptions}
              isAdmin={isAdmin}
              onUpdate={(patch) => actions.updateProvider(p.id, patch)}
              onRemove={() => {
                actions.removeProvider(p.id);
                toast({ title: "Provider removed", variant: "info" });
              }}
              onSetDefault={() => {
                actions.setDefaultProvider(p.id);
                toast({ title: `${p.label} set as default provider`, variant: "success" });
              }}
            />
          ))}
        </div>

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
