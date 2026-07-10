"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Circle, Loader2, PlayCircle, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { Badge, Button, EmptyState, Input, Modal } from "@/components/ui";
import { cn, type Tone } from "@/lib/utils";
import { useActions, useCampaigns } from "@/lib/store";
import { campaignToAriaContext, parseCommand, type AriaPlan } from "@/lib/aria-command";
import { shouldResetAriaChecklist } from "@/lib/aria-command-console-state";

type StepStatus = "idle" | "running" | "done" | "failed";
type StepResult = { count?: number; detail?: string };

const STATUS_META: Record<StepStatus, { icon: LucideIcon; tone: Tone; label: string; spin?: boolean }> = {
  idle: { icon: Circle, tone: "neutral", label: "Idle" },
  running: { icon: Loader2, tone: "electric", label: "Running…", spin: true },
  done: { icon: CheckCircle2, tone: "success", label: "Done" },
  failed: { icon: XCircle, tone: "danger", label: "Failed" },
};

export interface AriaCommandConsoleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill the instruction — e.g. from the ⌘K palette's "Run with Aria" result. */
  initialText?: string;
}

/**
 * Aria Command — type one instruction, see the plan Aria would run as a
 * checklist, then press Run. Every row ticks idle → running → done/failed
 * with a REAL result count pulled straight from the store actions'
 * return values (see runAriaPlan in store.ts). Nothing executes until Run is
 * pressed, and the run always halts with drafts sitting in the approval
 * queue — this console never shows or implies a "sent" state.
 */
export function AriaCommandConsole({ open, onOpenChange, initialText = "" }: AriaCommandConsoleProps) {
  const campaigns = useCampaigns();
  const actions = useActions();

  const [text, setText] = React.useState(initialText);
  const [running, setRunning] = React.useState(false);
  const [hasRun, setHasRun] = React.useState(false);
  const [statuses, setStatuses] = React.useState<StepStatus[]>([]);
  const [results, setResults] = React.useState<StepResult[]>([]);
  const lastChecklistTextRef = React.useRef<string | null>(null);

  // Re-seed the instruction whenever the console (re)opens with a new prefill.
  React.useEffect(() => {
    if (open) setText(initialText);
  }, [open, initialText]);

  const ctx = React.useMemo(() => ({ campaigns: campaigns.map(campaignToAriaContext) }), [campaigns]);

  const plan = React.useMemo<AriaPlan | null>(
    () => (text.trim() ? parseCommand(text, ctx) : null),
    [text, ctx],
  );

  // Editing the instruction (or opening with a new one) always resets the
  // checklist to idle — a stale green tick from a previous run/instruction
  // must never linger next to a plan it doesn't describe. Re-keyed on `text`
  // (not `plan`): a running step's side effects (e.g. sourcing mutates the
  // campaign store) change `campaigns` → `ctx` → give `plan` a brand-new
  // identity even though the instruction didn't change, which would otherwise
  // re-fire this effect and wipe the checklist mid-run. The `running` guard
  // is a second belt-and-braces check so an in-flight run's rows are never
  // reset out from under it.
  React.useEffect(() => {
    if (!shouldResetAriaChecklist({ previousText: lastChecklistTextRef.current, text, running })) return;
    lastChecklistTextRef.current = text;
    setStatuses(plan ? plan.steps.map(() => "idle") : []);
    setResults(plan ? plan.steps.map(() => ({})) : []);
    setHasRun(false);
  }, [text, plan, running]);

  const handleRun = React.useCallback(async () => {
    if (!plan || plan.steps.length === 0 || running) return;
    setRunning(true);
    setHasRun(true);
    setStatuses(plan.steps.map(() => "idle"));
    setResults(plan.steps.map(() => ({})));
    try {
      await actions.runAriaPlan(plan, (i, status, result) => {
        setStatuses((prev) => {
          const next = [...prev];
          next[i] = status;
          return next;
        });
        if (result) {
          setResults((prev) => {
            const next = [...prev];
            next[i] = result;
            return next;
          });
        }
      });
    } finally {
      setRunning(false);
    }
  }, [plan, running, actions]);

  const settled = hasRun && !running && statuses.length > 0 && statuses.every((s) => s !== "idle" && s !== "running");
  const hasSteps = !!plan && plan.steps.length > 0;

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Aria Command"
      description="Type one instruction. Aria previews the plan below. Nothing runs until you press Run."
      className="max-w-2xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
            Drafts only. Every message still waits for your approval. Nothing is ever sent automatically.
          </p>
          <Button
            leftIcon={<PlayCircle className="h-4 w-4" />}
            onClick={() => void handleRun()}
            loading={running}
            disabled={running || !hasSteps}
          >
            {hasRun ? "Run again" : "Run"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "source 15 backend engineers for the Berlin fintech role, draft outreach to the strong ones, and book anyone perfect"'
          aria-label="Aria instruction"
        />

        {!plan && (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" aria-hidden />}
            title="Waiting for an instruction"
            description="Describe what you want Aria to do: source, draft, follow up, book, pool, or report."
          />
        )}

        {plan && plan.steps.length === 0 && (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" aria-hidden />}
            title="No actionable command recognized"
            description="Aria couldn't find a source/draft/follow-up/book/pool/report instruction in that sentence. Nothing will run. Try naming an action and a role or campaign."
          />
        )}

        {hasSteps && plan && (
          <ol className="space-y-2" aria-label="Aria Command plan">
            {plan.steps.map((step, i) => {
              const status = statuses[i] ?? "idle";
              const result = results[i];
              const meta = STATUS_META[status];
              const StatusIcon = meta.icon;
              return (
                <li
                  key={`${step.verb}-${i}`}
                  className="flex items-start gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      status === "idle" && "text-muted",
                      status === "running" && "text-electric",
                      status === "done" && "text-success",
                      status === "failed" && "text-danger",
                    )}
                    aria-hidden
                  >
                    <StatusIcon className={cn("h-5 w-5", meta.spin && "animate-spin")} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{step.label}</p>
                    {result?.detail && (
                      <p className={cn("mt-0.5 text-xs", status === "failed" ? "text-danger" : "text-muted")}>
                        {result.detail}
                      </p>
                    )}
                  </div>
                  <Badge tone={meta.tone} size="sm" className="shrink-0">
                    {meta.label}
                  </Badge>
                </li>
              );
            })}
          </ol>
        )}

        {plan?.matchedCampaignId === undefined && hasSteps && (
          <p className="text-xs text-muted">
            No existing campaign matched this instruction. Steps will fail cleanly instead of guessing one. Open
            Campaigns and pick one, or mention its role/location.
          </p>
        )}

        {settled && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-success-soft px-3.5 py-3 text-sm text-success ring-1 ring-inset ring-success/20">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Run halted with drafts sitting in the outreach queue (0 messages sent).</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
