"use client";

import * as React from "react";
import { CheckCircle2, Cpu, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Select,
  useToast,
} from "@/components/ui";
import { useLlmProviders, useSavedModels } from "@/lib/store";

const ENDPOINT = "/api/admin/ai-runtime-bindings";

type Purpose = "requisition_parse" | "sourcing";

type CatalogProvider = {
  providerSlug: string;
  credentialProvider: string;
  endpointProfile: string;
  supportsRequisitionParse: boolean;
  supportsSourcing: boolean;
  catalogRevision: number;
};

type RuntimeKey = {
  id: string;
  name: string;
  provider: string;
  last4: string;
  status: "valid";
  lastTestedAt: string | null;
};

type RuntimeBinding = {
  purpose: Purpose;
  providerSlug: string;
  credentialProvider: string;
  endpointProfile: string;
  catalogRevision: number;
  modelName: string;
  apiKeyId: string;
  credentialAvailable: boolean;
};

type ActiveSet = {
  id: string;
  status: "active";
  setSha256: string;
  proposedAt: string;
  activatedAt: string | null;
  bindings: RuntimeBinding[];
};

type StagedSet = {
  id: string;
  status: "staged";
  setSha256: string;
  proposedAt: string;
  activatedAt: null;
  bindings: RuntimeBinding[];
  proposedBySelf: boolean;
  canActivate: boolean;
};

type AuthorityState = {
  ok: true;
  catalog: CatalogProvider[];
  keys: RuntimeKey[];
  activeSet: ActiveSet | null;
  stagedSets: StagedSet[];
  adminCount: number;
  self: {
    hasStagedProposal: boolean;
    canActivate: boolean;
  };
};

type BindingDraft = {
  providerSlug: string;
  modelName: string;
  apiKeyId: string;
};

type DraftState = Record<Purpose, BindingDraft>;

type PendingOperation = {
  fingerprint: string;
  idempotencyKey: string;
};

const EMPTY_DRAFT: DraftState = {
  requisition_parse: { providerSlug: "", modelName: "", apiKeyId: "" },
  sourcing: { providerSlug: "", modelName: "", apiKeyId: "" },
};

const PURPOSE_LABEL: Record<Purpose, string> = {
  requisition_parse: "Need parsing",
  sourcing: "Candidate sourcing",
};

const ERROR_MESSAGE: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in again to manage the AI runtime.",
  INSUFFICIENT_PERMISSIONS: "Only workspace admins can view or change runtime authority.",
  INVALID_REQUEST: "Review the provider, model, and key selections.",
  AI_RUNTIME_PROVIDER_UNSUPPORTED: "That provider does not support the selected runtime task.",
  AI_RUNTIME_CREDENTIAL_UNAVAILABLE: "A selected key is missing, invalid, or belongs to another provider.",
  AI_RUNTIME_MODEL_CAPABILITY_UNAVAILABLE: "A selected model could not prove the required runtime capability. Choose a compatible model and try again.",
  AI_RUNTIME_MODEL_VERIFICATION_UNAVAILABLE: "A model provider could not be verified right now. Wait briefly and try again.",
  AI_RUNTIME_IDEMPOTENCY_CONFLICT: "This operation conflicts with an earlier request. Refresh before retrying.",
  AI_RUNTIME_AUTHORITY_INVALID: "The binding authority is inconsistent. Refresh and contact an operator if it persists.",
  AI_RUNTIME_BINDING_SET_NOT_FOUND: "That staged binding set no longer exists.",
  AI_RUNTIME_INDEPENDENT_REVIEW_REQUIRED: "A different workspace admin must activate this proposal.",
  AI_RUNTIME_BINDING_RATE_LIMITED: "Too many runtime changes. Wait briefly before retrying.",
  AI_RUNTIME_AUTHORITY_CHANGED: "Your workspace authority changed during the request. Refresh before continuing.",
  AI_RUNTIME_BINDING_UNAVAILABLE: "Runtime authority is temporarily unavailable.",
};

function isAuthorityState(value: unknown): value is AuthorityState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AuthorityState>;
  return candidate.ok === true
    && Array.isArray(candidate.catalog)
    && Array.isArray(candidate.keys)
    && Array.isArray(candidate.stagedSets)
    && typeof candidate.adminCount === "number"
    && candidate.self !== null
    && typeof candidate.self === "object";
}

function responseCode(value: unknown): string {
  if (!value || typeof value !== "object") return "AI_RUNTIME_BINDING_UNAVAILABLE";
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : "AI_RUNTIME_BINDING_UNAVAILABLE";
}

function operationFor(
  current: PendingOperation | null,
  fingerprint: string,
): PendingOperation {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, idempotencyKey: crypto.randomUUID() };
}

function bindingFor(set: ActiveSet | StagedSet, purpose: Purpose): RuntimeBinding | null {
  return set.bindings.find((binding) => binding.purpose === purpose) ?? null;
}

function runtimeKeyLabel(keys: RuntimeKey[], binding: RuntimeBinding): string {
  const key = keys.find((candidate) => candidate.id === binding.apiKeyId);
  return key
    ? `${key.name} (••••${key.last4})`
    : "Credential is no longer valid";
}

function localDate(value: string | null): string {
  if (!value) return "Not activated";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown time" : date.toLocaleString();
}

function RuntimeSetSummary({
  bindingSet,
  keys,
}: {
  bindingSet: ActiveSet | StagedSet;
  keys: RuntimeKey[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(["requisition_parse", "sourcing"] as const).map((purpose) => {
        const binding = bindingFor(bindingSet, purpose);
        return (
          <div key={purpose} className="rounded-xl border border-line bg-surface px-3.5 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {PURPOSE_LABEL[purpose]}
            </p>
            {binding ? (
              <>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {binding.credentialProvider} · {binding.modelName}
                </p>
                <p className={binding.credentialAvailable ? "mt-1 text-xs text-muted" : "mt-1 text-xs text-danger"}>
                  {runtimeKeyLabel(keys, binding)}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-danger">Binding metadata unavailable</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AiRuntimeBindingsPanel() {
  const { toast } = useToast();
  const savedModels = useSavedModels();
  const planningProviders = useLlmProviders();
  const [authority, setAuthority] = React.useState<AuthorityState | null>(null);
  const [draft, setDraft] = React.useState<DraftState>(EMPTY_DRAFT);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [staging, setStaging] = React.useState(false);
  const [activating, setActivating] = React.useState<string | null>(null);
  const initializedDraft = React.useRef(false);
  const stageOperationRef = React.useRef<PendingOperation | null>(null);
  const activationOperationRef = React.useRef<PendingOperation | null>(null);

  const planningProviderById = React.useMemo(
    () => new Map(planningProviders.map((provider) => [provider.id, provider])),
    [planningProviders],
  );

  const loadAuthority = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isAuthorityState(payload)) {
        const code = responseCode(payload);
        setLoadError(ERROR_MESSAGE[code] ?? ERROR_MESSAGE.AI_RUNTIME_BINDING_UNAVAILABLE);
        setAuthority(null);
        return;
      }
      setAuthority(payload);
      setLoadError(null);
      if (!initializedDraft.current) {
        const source = payload.stagedSets.find((set) => set.proposedBySelf) ?? payload.activeSet;
        if (source) {
          const parseBinding = bindingFor(source, "requisition_parse");
          const sourcingBinding = bindingFor(source, "sourcing");
          if (parseBinding && sourcingBinding) {
            setDraft({
              requisition_parse: {
                providerSlug: parseBinding.providerSlug,
                modelName: parseBinding.modelName,
                apiKeyId: parseBinding.credentialAvailable ? parseBinding.apiKeyId : "",
              },
              sourcing: {
                providerSlug: sourcingBinding.providerSlug,
                modelName: sourcingBinding.modelName,
                apiKeyId: sourcingBinding.credentialAvailable ? sourcingBinding.apiKeyId : "",
              },
            });
          }
        }
        initializedDraft.current = true;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setAuthority(null);
      setLoadError(ERROR_MESSAGE.AI_RUNTIME_BINDING_UNAVAILABLE);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadAuthority(controller.signal);
    return () => controller.abort();
  }, [loadAuthority]);

  const modelSuggestions = React.useCallback((providerSlug: string) => {
    const credentialProvider = authority?.catalog.find(
      (provider) => provider.providerSlug === providerSlug,
    )?.credentialProvider;
    if (!credentialProvider) return [];
    return savedModels
      .filter((model) => {
        const provider = planningProviderById.get(model.providerId);
        const plannedCredential = provider?.kind === "Kimi" ? "Kimi (Moonshot)" : provider?.kind;
        return model.enabled && plannedCredential === credentialProvider;
      })
      .map((model) => model.modelName)
      .filter((modelName, index, all) => all.indexOf(modelName) === index);
  }, [authority, planningProviderById, savedModels]);

  function providersFor(purpose: Purpose): CatalogProvider[] {
    return (authority?.catalog ?? []).filter((provider) =>
      purpose === "requisition_parse"
        ? provider.supportsRequisitionParse
        : provider.supportsSourcing,
    );
  }

  function keysFor(providerSlug: string): RuntimeKey[] {
    const credentialProvider = authority?.catalog.find(
      (provider) => provider.providerSlug === providerSlug,
    )?.credentialProvider;
    return (authority?.keys ?? []).filter((key) => key.provider === credentialProvider);
  }

  function updateDraft(purpose: Purpose, patch: Partial<BindingDraft>) {
    setDraft((current) => ({
      ...current,
      [purpose]: { ...current[purpose], ...patch },
    }));
  }

  function changeProvider(purpose: Purpose, providerSlug: string) {
    setDraft((current) => {
      const selectedProvider = authority?.catalog.find(
        (provider) => provider.providerSlug === providerSlug,
      );
      const selectedKey = authority?.keys.find((key) => key.id === current[purpose].apiKeyId);
      return {
        ...current,
        [purpose]: {
          providerSlug,
          modelName: current[purpose].modelName,
          apiKeyId: selectedKey?.provider === selectedProvider?.credentialProvider
            ? current[purpose].apiKeyId
            : "",
        },
      };
    });
  }

  const stageReady = (["requisition_parse", "sourcing"] as const).every((purpose) =>
    draft[purpose].providerSlug.length > 0
      && draft[purpose].modelName.trim().length > 0
      && draft[purpose].apiKeyId.length > 0,
  );

  async function stageBindings() {
    if (!stageReady) {
      toast({
        title: "Complete both runtime bindings",
        description: "Choose a provider, exact model ID, and valid key for both tasks.",
        variant: "warning",
      });
      return;
    }
    const body = {
      requisitionParse: {
        providerSlug: draft.requisition_parse.providerSlug,
        modelName: draft.requisition_parse.modelName.trim(),
        apiKeyId: draft.requisition_parse.apiKeyId,
      },
      sourcing: {
        providerSlug: draft.sourcing.providerSlug,
        modelName: draft.sourcing.modelName.trim(),
        apiKeyId: draft.sourcing.apiKeyId,
      },
    };
    const fingerprint = JSON.stringify(body);
    const operation = operationFor(stageOperationRef.current, fingerprint);
    stageOperationRef.current = operation;
    setStaging(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": operation.idempotencyKey,
        },
        body: fingerprint,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
        if (response.status < 500) stageOperationRef.current = null;
        const code = responseCode(payload);
        throw new Error(ERROR_MESSAGE[code] ?? ERROR_MESSAGE.AI_RUNTIME_BINDING_UNAVAILABLE);
      }
      stageOperationRef.current = null;
      toast({
        title: "Runtime proposal staged",
        description: "A different workspace admin must review and activate it.",
        variant: "success",
      });
      await loadAuthority();
    } catch (error) {
      toast({
        title: "Could not stage runtime bindings",
        description: error instanceof Error ? error.message : ERROR_MESSAGE.AI_RUNTIME_BINDING_UNAVAILABLE,
        variant: "error",
      });
    } finally {
      setStaging(false);
    }
  }

  async function activateBindings(bindingSetId: string) {
    const fingerprint = JSON.stringify({ bindingSetId });
    const operation = operationFor(activationOperationRef.current, fingerprint);
    activationOperationRef.current = operation;
    setActivating(bindingSetId);
    try {
      const response = await fetch(ENDPOINT, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": operation.idempotencyKey,
        },
        body: fingerprint,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
        if (response.status < 500) activationOperationRef.current = null;
        const code = responseCode(payload);
        throw new Error(ERROR_MESSAGE[code] ?? ERROR_MESSAGE.AI_RUNTIME_BINDING_UNAVAILABLE);
      }
      activationOperationRef.current = null;
      toast({
        title: "Runtime bindings activated",
        description: "Need parsing and candidate sourcing now use the reviewed authority set.",
        variant: "success",
      });
      await loadAuthority();
    } catch (error) {
      toast({
        title: "Could not activate runtime bindings",
        description: error instanceof Error ? error.message : ERROR_MESSAGE.AI_RUNTIME_BINDING_UNAVAILABLE,
        variant: "error",
      });
    } finally {
      setActivating(null);
    }
  }

  if (loading && !authority) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6 text-sm text-muted">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
          Loading reviewed runtime authority…
        </CardContent>
      </Card>
    );
  }

  if (!authority) {
    return (
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-start gap-3 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{loadError ?? ERROR_MESSAGE.AI_RUNTIME_BINDING_UNAVAILABLE}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadAuthority()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-electric/10 text-electric">
                <ShieldCheck className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Reviewed execution authority</p>
                <p className="mt-1 max-w-2xl text-xs text-muted">
                  This normalized binding controls the provider, exact model, and vault key used by live need parsing and sourcing. Provider and model cards above are planning metadata only.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={authority.activeSet ? "success" : "warning"} size="sm" dot>
                {authority.activeSet ? "Active" : "Not configured"}
              </Badge>
              <Badge tone="neutral" size="sm">
                {authority.adminCount} admin{authority.adminCount === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>

          {authority.activeSet ? (
            <div className="space-y-3 rounded-2xl border border-success/30 bg-success-soft/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                  <p className="text-sm font-semibold text-ink">Active reviewed set</p>
                </div>
                <span className="text-xs text-muted">
                  Activated {localDate(authority.activeSet.activatedAt)} · hash {authority.activeSet.setSha256.slice(0, 12)}…
                </span>
              </div>
              <RuntimeSetSummary bindingSet={authority.activeSet} keys={authority.keys} />
            </div>
          ) : (
            <div className="rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-[hsl(32_90%_34%)]">
              No reviewed runtime binding is active. Live need parsing and AI-backed sourcing remain unavailable until two different admins stage and activate a complete set.
            </div>
          )}

          {authority.adminCount < 2 && (
            <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-[hsl(32_90%_34%)]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                A second workspace admin is required before any runtime proposal can be activated. Add and verify that administrator through Access &amp; roles first.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-ink">Stage a complete runtime proposal</p>
            <p className="mt-1 text-xs text-muted">
              Enter the provider&apos;s exact model ID. Suggestions come only from saved planning models and are never treated as runtime authority until this proposal is independently activated.
            </p>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            {(["requisition_parse", "sourcing"] as const).map((purpose) => {
              const suggestions = modelSuggestions(draft[purpose].providerSlug);
              const availableKeys = keysFor(draft[purpose].providerSlug);
              const datalistId = `runtime-model-suggestions-${purpose}`;
              return (
                <div key={purpose} className="space-y-4 rounded-2xl border border-line p-4">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-electric" aria-hidden />
                    <p className="text-sm font-semibold text-ink">{PURPOSE_LABEL[purpose]}</p>
                  </div>
                  <Field label="Provider" htmlFor={`runtime-provider-${purpose}`}>
                    <Select
                      id={`runtime-provider-${purpose}`}
                      value={draft[purpose].providerSlug}
                      onChange={(event) => changeProvider(purpose, event.target.value)}
                      options={[
                        { value: "", label: "Select supported provider" },
                        ...providersFor(purpose).map((provider) => ({
                          value: provider.providerSlug,
                          label: provider.credentialProvider,
                        })),
                      ]}
                    />
                  </Field>
                  <Field
                    label="Exact model ID"
                    htmlFor={`runtime-model-${purpose}`}
                    hint={suggestions.length > 0 ? "Saved model names are available as suggestions." : "Enter the exact ID documented by the selected provider."}
                  >
                    <Input
                      id={`runtime-model-${purpose}`}
                      list={datalistId}
                      value={draft[purpose].modelName}
                      onChange={(event) => updateDraft(purpose, { modelName: event.target.value })}
                      placeholder="Enter exact provider model ID"
                      autoComplete="off"
                    />
                    <datalist id={datalistId}>
                      {suggestions.map((modelName) => (
                        <option key={modelName} value={modelName} />
                      ))}
                    </datalist>
                  </Field>
                  <Field
                    label="Validated vault key"
                    htmlFor={`runtime-key-${purpose}`}
                    hint="Only valid keys matching the selected provider are listed."
                  >
                    <Select
                      id={`runtime-key-${purpose}`}
                      value={draft[purpose].apiKeyId}
                      onChange={(event) => updateDraft(purpose, { apiKeyId: event.target.value })}
                      options={[
                        {
                          value: "",
                          label: draft[purpose].providerSlug && availableKeys.length === 0
                            ? "No valid key for this provider"
                            : "Select a valid key",
                        },
                        ...availableKeys.map((key) => ({
                          value: key.id,
                          label: `${key.name} (••••${key.last4})`,
                        })),
                      ]}
                    />
                  </Field>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="max-w-2xl text-xs text-muted">
              Staging does not change production behavior. A different workspace admin must review and activate the immutable proposal.
            </p>
            <Button loading={staging} disabled={!stageReady || staging} onClick={() => void stageBindings()}>
              Stage for independent review
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink">Pending independent review</p>
              <p className="mt-1 text-xs text-muted">Activation is recorded against the signed-in reviewer, never a client-supplied actor.</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />}
              disabled={loading}
              onClick={() => void loadAuthority()}
            >
              Refresh
            </Button>
          </div>

          {authority.stagedSets.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-sm text-muted">
              No runtime proposals are waiting for review.
            </p>
          ) : (
            <div className="space-y-3">
              {authority.stagedSets.map((bindingSet) => (
                <div key={bindingSet.id} className="space-y-3 rounded-2xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-ink">Proposal {bindingSet.setSha256.slice(0, 12)}…</p>
                        {bindingSet.proposedBySelf && <Badge tone="neutral" size="sm">Your proposal</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted">Staged {localDate(bindingSet.proposedAt)}</p>
                    </div>
                    <Button
                      size="sm"
                      loading={activating === bindingSet.id}
                      disabled={!bindingSet.canActivate || activating !== null}
                      onClick={() => void activateBindings(bindingSet.id)}
                    >
                      Activate reviewed set
                    </Button>
                  </div>
                  <RuntimeSetSummary bindingSet={bindingSet} keys={authority.keys} />
                  {!bindingSet.canActivate && (
                    <p className="text-xs text-warning">
                      {bindingSet.proposedBySelf
                        ? "A different workspace admin must activate this proposal."
                        : "Activation requires at least two active workspace admins."}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
