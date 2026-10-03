"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Badge,
  Card,
  CardContent,
  Field,
  Select,
  useToast,
} from "@/components/ui";
import {
  useActions,
  useDefaultModels,
  useLlmProviders,
  useRole,
  useSavedModels,
} from "@/lib/store";
import type { ModelTask } from "@/lib/types";
import { can } from "@/lib/rbac";
import { BrainCircuit, MessageSquare, Search, Send } from "lucide-react";

const TASKS: {
  task: ModelTask;
  label: string;
  hint: string;
  icon: React.ReactNode;
  /** Models whose provider cannot run this task (Kimi → sourcing). */
  excludeKinds?: string[];
}[] = [
  {
    task: "sourcing",
    label: "Sourcing agent",
    hint: "Finds and ranks candidates. Needs a tool-calling model (not Kimi).",
    icon: <Search className="h-4 w-4" aria-hidden />,
    excludeKinds: ["Kimi"],
  },
  {
    task: "chat",
    label: "Intake / JD parse",
    hint: "Turns Outlook needs and pasted briefs into structured roles.",
    icon: <MessageSquare className="h-4 w-4" aria-hidden />,
  },
  {
    task: "outreach",
    label: "Outreach drafts",
    hint: "Writes emails and LinkedIn messages for human approval.",
    icon: <Send className="h-4 w-4" aria-hidden />,
  },
  {
    task: "classification",
    label: "Reply classification",
    hint: "Labels inbound replies (interested, OO, not now, …).",
    icon: <BrainCircuit className="h-4 w-4" aria-hidden />,
  },
];

export function RecruitmentLlmPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_models");
  const models = useSavedModels();
  const providers = useLlmProviders();
  const defaultModels = useDefaultModels();
  const actions = useActions();
  const { toast } = useToast();

  const providerById = React.useMemo(
    () => Object.fromEntries(providers.map((p) => [p.id, p])),
    [providers],
  );

  function optionsFor(task: ModelTask, excludeKinds?: string[]) {
    return [
      { value: "", label: "Not set — configure below" },
      ...models
        .filter((m) => {
          if (!m.enabled) return false;
          const kind = providerById[m.providerId]?.kind;
          if (!kind) return false;
          if (!providerById[m.providerId]?.enabled) return false;
          if (excludeKinds?.includes(kind)) return false;
          return true;
        })
        .map((m) => ({
          value: m.id,
          label: `${m.label} · ${providerById[m.providerId]?.label ?? "provider"}`,
        })),
    ];
  }

  function setTask(task: ModelTask, modelId: string) {
    if (!modelId) {
      toast({
        title: "Pick a model",
        description: "Enable a provider and add a model first, then choose it here.",
        variant: "warning",
      });
      return;
    }
    actions.setModelDefaultForTask(modelId, task);
    const label = models.find((m) => m.id === modelId)?.label ?? modelId;
    toast({ title: `${label} runs ${task}`, variant: "success" });
  }

  return (
    <Card className="overflow-hidden border-aqua/25 bg-gradient-to-br from-surface to-aqua/[0.05]">
      <CardContent className="space-y-5">
        <div>
          <p className="text-sm font-semibold text-ink">Recruitment brain — pick once</p>
          <p className="mt-1 text-xs text-muted">
            One dropdown per job. No YAML, no env files. Admins can still add providers and models in the
            lists below.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {TASKS.map((row, i) => {
            const current = defaultModels[row.task] ?? "";
            const opts = optionsFor(row.task, row.excludeKinds);
            const missing = !current || !opts.some((o) => o.value === current);
            return (
              <motion.div
                key={row.task}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, type: "spring", stiffness: 320, damping: 26 }}
                className="rounded-2xl border border-line bg-surface/80 p-4"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink/[0.06] text-ink-soft">
                      {row.icon}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">{row.label}</p>
                      <p className="mt-0.5 text-xs text-muted">{row.hint}</p>
                    </div>
                  </div>
                  <Badge tone={missing ? "warning" : "success"} size="sm">
                    {missing ? "Set me" : "Ready"}
                  </Badge>
                </div>
                <Field label="Model" htmlFor={`recruit-llm-${row.task}`}>
                  <Select
                    id={`recruit-llm-${row.task}`}
                    value={missing ? "" : current}
                    disabled={!isAdmin}
                    onChange={(e) => setTask(row.task, e.target.value)}
                    options={opts}
                  />
                </Field>
              </motion.div>
            );
          })}
        </div>

        {!isAdmin ? (
          <p className="text-xs text-muted">Only admins can change which LLM runs each recruitment step.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
