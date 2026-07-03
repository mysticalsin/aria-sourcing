"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, Badge, SkeletonCard } from "@/components/ui";
import { useSettings, useSeats, useGuardrails } from "@/lib/store";
import { getHermesConfig, hermesRuntimeAvailable } from "@/lib/ai/hermes-runtime";
import { Server } from "lucide-react";

export function HermesConfigPanel() {
  const settings = useSettings();
  const seats = useSeats();
  const guardrails = useGuardrails();
  const live = hermesRuntimeAvailable(settings);
  const [config, setConfig] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Demo-mode config preview — composed from local settings/guardrails (not a
  // fabricated runtime response) so the panel never dead-ends when the Aria
  // runtime isn't connected.
  const demoConfig = React.useMemo(
    () => ({
      system_identity: settings.systemIdentity,
      operator_name: settings.operatorName,
      dry_run_mode: settings.dryRunMode,
      human_approval_gate: settings.humanApprovalGate,
      confidentiality_mode: settings.confidentialityMode,
      default_language: settings.defaultLanguage,
      sla_minutes: settings.slaMinutes,
      agents_configured: seats.length,
      guardrail_rules: guardrails.rules.length,
      active_guardrails: guardrails.rules.filter((r) => r.enabled).length,
    }),
    [settings, seats.length, guardrails],
  );

  React.useEffect(() => {
    if (!live) {
      setConfig(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getHermesConfig(settings).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok && res.data) setConfig(res.data as Record<string, unknown>);
    });
    return () => {
      cancelled = true;
    };
  }, [live, settings]);

  if (!live) {
    return (
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Eyebrow className="flex items-center gap-1.5">
              <Server className="h-3 w-3" aria-hidden /> Aria config
            </Eyebrow>
            <Badge tone="warning" size="sm">Demo</Badge>
          </div>
          <pre className="max-h-[320px] overflow-auto rounded-xl border border-line bg-canvas p-3 text-[10px] text-ink-soft">
            {JSON.stringify(demoConfig, null, 2)}
          </pre>
          <p className="text-xs text-muted">
            Local config preview — enable Aria live mode in Settings to inspect the runtime&apos;s actual configuration.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Eyebrow className="flex items-center gap-1.5">
            <Server className="h-3 w-3" aria-hidden /> Aria config
          </Eyebrow>
          <Badge tone="success" size="sm" dot>Live</Badge>
        </div>
        {loading ? (
          <SkeletonCard />
        ) : !config ? (
          <p className="text-xs text-muted">Could not load config from hermes-agent.</p>
        ) : (
          <pre className="max-h-[320px] overflow-auto rounded-xl border border-line bg-canvas p-3 text-[10px] text-ink-soft">
            {JSON.stringify(config, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
