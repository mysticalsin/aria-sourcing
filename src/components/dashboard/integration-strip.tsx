"use client";

import * as React from "react";
import { Eyebrow } from "@/components/ui";
import { useIntegrations } from "@/lib/store";
import { integrationCounts, integrationStateLabel } from "@/lib/integrations";
import { cn, toneForHealth, pluralize, type Tone } from "@/lib/utils";
import { Plug } from "lucide-react";

const DOT: Record<Tone, string> = {
  neutral: "bg-ink/30",
  tangerine: "bg-tangerine",
  electric: "bg-electric",
  aqua: "bg-aqua",
  violet: "bg-violet",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function IntegrationStrip() {
  const integrations = useIntegrations();
  // Same count as the sidebar and Settings: built integrations, live apart from simulated.
  const summary = integrationCounts(integrations);
  const detail = [
    summary.simulated > 0 ? `${summary.simulated} simulated` : "",
    summary.degraded > 0 ? pluralize(summary.degraded, "degraded", "degraded") : "",
    summary.error > 0 ? pluralize(summary.error, "error") : "",
    summary.notConfigured > 0 ? `${summary.notConfigured} not configured` : "",
  ].filter(Boolean);

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 shadow-soft animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        {/* Summary — left */}
        <div className="flex shrink-0 items-center gap-3 lg:w-56">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-aqua-soft text-aqua"
            aria-hidden
          >
            <Plug className="h-5 w-5" />
          </span>
          <div>
            <Eyebrow>Integrations</Eyebrow>
            <p className="mt-0.5 text-sm font-semibold text-ink">
              {summary.live}/{summary.total} live
            </p>
            <p className="text-xs text-muted">{detail.length > 0 ? detail.join(" · ") : "all systems nominal"}</p>
          </div>
        </div>

        {/* Chips — scrollable strip */}
        <div
          className="relative -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1 lg:flex-1"
          role="list"
          aria-label="Integration status"
        >
          {integrations.map((integration) => {
            const state = integrationStateLabel(integration);
            const tone: Tone = state === "Simulated" || state === "Concept" ? "neutral" : toneForHealth(integration.status);
            return (
              <span
                key={integration.id}
                role="listitem"
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-canvas/50 py-1.5 pl-3 pr-2 text-sm"
              >
                <span className={cn("h-2 w-2 rounded-full", DOT[tone])} aria-hidden />
                <span className="font-medium text-ink">{integration.name}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide",
                    state === "Live" ? "bg-success-soft text-success" : "bg-ink/[0.06] text-ink-soft",
                  )}
                >
                  {state}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
