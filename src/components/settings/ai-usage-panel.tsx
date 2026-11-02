"use client";

import * as React from "react";
import { Badge, Button, Progress } from "@/components/ui";
import { useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import type { AiUsageReport } from "@/lib/ai/usage";
import type { Tone } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

const TASK_LABEL: Record<string, string> = {
  classify: "Reply classification",
  extract: "Brief extraction",
  outreach: "Outreach drafts",
  sourcing: "Sourcing agent",
  chat: "Assistant chat",
};

const usd = (value: number) => `$${value < 10 ? value.toFixed(2) : value.toFixed(0)}`;
/** Caps are set by hand, usually whole dollars: "$6", not "$6.00". */
const usdCap = (value: number) => (Number.isInteger(value) ? `$${value}` : usd(value));
const count = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value));

/** Status of one budget: the tone always comes with a text label. */
function budgetState(spent: number, cap: number): { tone: Tone; label: string } {
  if (cap <= 0 || spent >= cap) return { tone: "danger", label: "Cap reached: AI paused, fallbacks in use" };
  if (spent / cap >= 0.8) return { tone: "warning", label: "Close to the cap" };
  return { tone: "success", label: "Within budget" };
}

function BudgetMeter({ label, spent, cap }: { label: string; spent: number; cap: number }) {
  const state = budgetState(spent, cap);
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 100;
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink">
        {usd(spent)} <span className="text-sm font-semibold text-muted">of {usdCap(cap)}</span>
      </p>
      <Progress value={pct} tone={state.tone} className="mt-3" aria-label={`${label}: ${usd(spent)} of ${usdCap(cap)}`} />
      <p className="mt-2 text-xs text-muted">{state.label}</p>
    </div>
  );
}

/**
 * Month-to-date Claude spend: budget meters for the month and the day, and
 * the cost per task and model. Figures are the app's own estimate from token
 * counts; the Anthropic Console stays the billing reference and holds the
 * hard spend limit. Admin only, like the rest of AI settings.
 */
export function AiUsagePanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_models");
  const [report, setReport] = React.useState<AiUsageReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/usage", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "Admins only." : "Usage is unavailable.");
      setReport((await res.json()) as AiUsageReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Usage is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin) return <p className="text-sm text-muted">Claude usage is visible to admins.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">Claude usage</h3>
          <p className="text-xs text-muted">
            Estimated from token counts{report ? ` · ${report.month} · ${report.calls} calls` : ""}. Billing and the hard
            spend limit live in the Anthropic Console.
          </p>
        </div>
        <Button variant="outline" size="sm" loading={loading} leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BudgetMeter label="This month" spent={report.monthUsd} cap={report.monthlyLimitUsd} />
            <BudgetMeter label="Today" spent={report.dayUsd} cap={report.dailyLimitUsd} />
          </div>

          {report.byTask.length === 0 ? (
            <p className="text-sm text-muted">No Claude call yet this month.</p>
          ) : (
            <div className="relative overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[480px] text-sm">
                <caption className="sr-only">Claude cost per task and model this month</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th scope="col" className="px-3 py-2 font-semibold">Task</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Model</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Calls</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Tokens in / out</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byTask.map((row) => (
                    <tr key={`${row.task} ${row.model}`} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-ink">{TASK_LABEL[row.task] ?? row.task}</td>
                      <td className="px-3 py-2">
                        <Badge tone="neutral" size="sm">{row.model.replace(/^claude-/, "")}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{row.calls}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                        {count(row.inputTokens)} / {count(row.outputTokens)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{usd(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
