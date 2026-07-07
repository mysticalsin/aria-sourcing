"use client";

import * as React from "react";
import { Eyebrow } from "@/components/ui";
import { useIntegrations } from "@/lib/store";
import { realIntegrationSummary } from "@/lib/integrations";
import { cn, toneForHealth, pluralize, type Tone } from "@/lib/utils";
import type { IntegrationStatus } from "@/lib/types";
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

const HEALTH_LABEL: Record<IntegrationStatus["status"], string> = {
  connected: "Connected",
  degraded: "Degraded",
  error: "Error",
  not_configured: "Not configured",
};

export function IntegrationStrip() {
  const integrations = useIntegrations();
  const summary = realIntegrationSummary(integrations);

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
              {summary.connected}/{summary.total} connected
            </p>
            <p className="text-xs text-muted">
              {summary.degraded > 0 && `${pluralize(summary.degraded, "degraded", "degraded")} · `}
              {summary.error > 0 && `${pluralize(summary.error, "error")} · `}
              {summary.notConfigured > 0
                ? `${summary.notConfigured} not configured`
                : "all systems nominal"}
            </p>
          </div>
        </div>

        {/* Chips — scrollable strip */}
        <div
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-1"
          role="list"
          aria-label="Integration status"
        >
          {integrations.map((integration) => {
            const tone = toneForHealth(integration.status);
            return (
              <span
                key={integration.id}
                role="listitem"
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-canvas/50 py-1.5 pl-3 pr-2 text-sm"
              >
                <span className={cn("h-2 w-2 rounded-full", DOT[tone])} aria-hidden />
                <span className="sr-only">{HEALTH_LABEL[integration.status]}</span>
                <span className="font-medium text-ink">{integration.name}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide",
                    integration.mode === "live"
                      ? "bg-success-soft text-success"
                      : "bg-ink/[0.06] text-ink-soft",
                  )}
                >
                  {integration.mode}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
