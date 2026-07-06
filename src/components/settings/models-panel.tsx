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
  useToast,
} from "@/components/ui";
import {
  useActions,
  useLlmProviders,
  useSavedModels,
  useDefaultModels,
  useRole,
} from "@/lib/store";
import type { LlmProviderKind, ModelTask, SavedModel } from "@/lib/types";
import { can } from "@/lib/rbac";
import { BrainCircuit, Plus, Star, Trash2 } from "lucide-react";

const TASKS: ModelTask[] = ["sourcing", "outreach", "classification", "chat"];

const TASK_LABEL: Record<ModelTask, string> = {
  sourcing: "Sourcing",
  outreach: "Outreach",
  classification: "Classification",
  chat: "Chat",
};

/* ---- ModelRow ------------------------------------------------------------ */

function ModelRow({
  model,
  providerLabel,
  providerKind,
  defaultModels,
  isAdmin,
  onUpdate,
  onRemove,
  onSetDefaultForTask,
}: {
  model: SavedModel;
  providerLabel: string;
  providerKind?: LlmProviderKind;
  defaultModels: Partial<Record<ModelTask, string>>;
  isAdmin: boolean;
  onUpdate: (patch: Partial<SavedModel>) => void;
  onRemove: () => void;
  onSetDefaultForTask: (task: ModelTask) => void;
}) {
  const currentDefaultTasks = TASKS.filter((t) => defaultModels[t] === model.id);

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink/[0.06] text-ink-soft">
            <BrainCircuit className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{model.label}</p>
            <p className="mt-0.5 text-xs text-muted">
              {model.modelName}
              {model.contextWindow ? ` · ${(model.contextWindow / 1000).toFixed(0)}k ctx` : ""}
              {" · "}{providerLabel}
            </p>
            {providerKind === "Kimi" && (
              <p className="mt-0.5 text-xs text-warning">No tool-calling — can&apos;t run the sourcing agent</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            id={`enable-model-${model.id}`}
            checked={model.enabled}
            onCheckedChange={(v) => onUpdate({ enabled: v })}
            label={model.enabled ? "Enabled" : "Disabled"}
            disabled={!isAdmin}
          />
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={onRemove}
              title="Remove model"
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TASKS.map((task) => {
          const isDefault = currentDefaultTasks.includes(task);
          return (
            <button
              key={task}
              type="button"
              disabled={!isAdmin}
              onClick={() => isAdmin && !isDefault && onSetDefaultForTask(task)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                isDefault
                  ? "bg-electric/10 text-electric"
                  : "bg-ink/[0.05] text-muted hover:bg-ink/[0.1]"
              } disabled:cursor-default disabled:opacity-70`}
              title={isDefault ? `Default for ${task}` : `Set as default for ${task}`}
            >
              {isDefault && <Star className="h-2.5 w-2.5" />}
              {TASK_LABEL[task]}
            </button>
          );
        })}
        <span className="text-xs text-muted self-center">Click task to set as default</span>
      </div>
    </div>
  );
}

/* ---- ModelsPanel --------------------------------------------------------- */

const EMPTY_MODEL = {
  providerId: "",
  modelName: "",
  label: "",
  contextWindow: "" as string | number,
  enabled: true,
};

export function ModelsPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_models");
  const models = useSavedModels();
  const providers = useLlmProviders();
  const defaultModels = useDefaultModels();
  const actions = useActions();
  const { toast } = useToast();

  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState({ ...EMPTY_MODEL });

  const providerOptions = providers.map((p) => ({ value: p.id, label: p.label }));
  const providerMap = Object.fromEntries(providers.map((p) => [p.id, p.label]));
  const providerKindMap = Object.fromEntries(providers.map((p) => [p.id, p.kind]));

  function handleAdd() {
    if (!draft.providerId) {
      toast({ title: "Provider required", description: "Select a provider before adding a model.", variant: "warning" });
      return;
    }
    if (!draft.modelName.trim()) {
      toast({ title: "Model name required", variant: "warning" });
      return;
    }
    actions.addModel({
      providerId: draft.providerId,
      modelName: draft.modelName.trim(),
      label: draft.label.trim() || draft.modelName.trim(),
      contextWindow: draft.contextWindow ? Number(draft.contextWindow) : undefined,
      enabled: true,
    });
    toast({ title: `Model added: ${draft.label || draft.modelName}`, variant: "success" });
    setDraft({ ...EMPTY_MODEL });
    setAdding(false);
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        {models.length === 0 && (
          <p className="text-sm text-muted">No models registered yet.</p>
        )}

        <div className="space-y-3">
          {models.map((m) => (
            <ModelRow
              key={m.id}
              model={m}
              providerLabel={providerMap[m.providerId] ?? m.providerId}
              providerKind={providerKindMap[m.providerId]}
              defaultModels={defaultModels}
              isAdmin={isAdmin}
              onUpdate={(patch) => actions.updateModel(m.id, patch)}
              onRemove={() => {
                actions.removeModel(m.id);
                toast({ title: "Model removed", variant: "info" });
              }}
              onSetDefaultForTask={(task) => {
                actions.setModelDefaultForTask(m.id, task);
                toast({ title: `${m.label} set as default for ${task}`, variant: "success" });
              }}
            />
          ))}
        </div>

        {isAdmin && (
          <div className="border-t border-line pt-4">
            {adding ? (
              <div className="space-y-3 rounded-2xl border border-dashed border-line p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Add model</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Provider" htmlFor="new-model-prov">
                    <Select
                      id="new-model-prov"
                      value={draft.providerId}
                      onChange={(e) => setDraft((d) => ({ ...d, providerId: e.target.value }))}
                      options={[{ value: "", label: "Select provider" }, ...providerOptions]}
                    />
                  </Field>
                  <Field label="Model name (API id)" htmlFor="new-model-name">
                    <Input
                      id="new-model-name"
                      value={draft.modelName}
                      onChange={(e) => setDraft((d) => ({ ...d, modelName: e.target.value }))}
                      placeholder="e.g. claude-opus-4-5"
                    />
                  </Field>
                  <Field label="Display label" htmlFor="new-model-label" hint="Friendly name shown in the UI.">
                    <Input
                      id="new-model-label"
                      value={draft.label}
                      onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                      placeholder={draft.modelName || "e.g. Claude Opus 4.5"}
                    />
                  </Field>
                  <Field label="Context window (tokens)" htmlFor="new-model-ctx" hint="Optional (for display only).">
                    <Input
                      id="new-model-ctx"
                      type="number"
                      value={draft.contextWindow}
                      onChange={(e) => setDraft((d) => ({ ...d, contextWindow: e.target.value }))}
                      placeholder="200000"
                    />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAdd}>Add model</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft({ ...EMPTY_MODEL }); }}>
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
                Add model
              </Button>
            )}
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted">Admins only. Contact your workspace admin to manage models.</p>
        )}
      </CardContent>
    </Card>
  );
}
