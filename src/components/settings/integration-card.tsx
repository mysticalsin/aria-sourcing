"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  Eyebrow,
  Badge,
  Button,
  Modal,
  Switch,
  useToast,
} from "@/components/ui";
import { useActions } from "@/lib/store";
import type { IntegrationStatus } from "@/lib/types";
import { toneForHealth, formatTimeAgo, cn } from "@/lib/utils";
import {
  Inbox,
  Search,
  Sparkles,
  Database,
  Calendar,
  MessageSquare,
  Server,
  Plug,
  Activity,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

const CATEGORY_ICON: Record<IntegrationStatus["category"], React.ReactNode> = {
  Inbox: <Inbox className="h-5 w-5" />,
  Sourcing: <Search className="h-5 w-5" />,
  Enrichment: <Sparkles className="h-5 w-5" />,
  CRM: <Database className="h-5 w-5" />,
  Calendar: <Calendar className="h-5 w-5" />,
  Comms: <MessageSquare className="h-5 w-5" />,
  Infra: <Server className="h-5 w-5" />,
};

const HEALTH_LABEL: Record<IntegrationStatus["status"], string> = {
  connected: "Connected",
  degraded: "Degraded",
  error: "Error",
  not_configured: "Not configured",
};

export function IntegrationCard({ integration }: { integration: IntegrationStatus }) {
  const actions = useActions();
  const { toast } = useToast();
  const [configureOpen, setConfigureOpen] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  const isLive = integration.mode === "live";

  function handleTest() {
    setTesting(true);
    const result = actions.testIntegration(integration.id);
    setTesting(false);
    toast({
      title: result.ok ? `${integration.name} reachable` : `${integration.name} unreachable`,
      description: `${result.message}${result.ok ? ` · ${result.latencyMs}ms` : ""}`,
      variant: result.ok ? "success" : "error",
    });
  }

  function handleToggleMode() {
    const nextMode = isLive ? "mock" : "live";
    actions.toggleIntegrationMode(integration.id);
    toast({
      title: `${integration.name} → ${nextMode === "live" ? "Live" : "Mock"} mode`,
      description:
        nextMode === "live"
          ? "Live mode would use real credentials. This demo still runs dry-run only."
          : "Mock mode is the safe default — no real calls are made.",
      variant: nextMode === "live" ? "warning" : "info",
    });
  }

  const tone = toneForHealth(integration.status);

  return (
    <>
      <Card className="flex h-full flex-col">
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                tone === "success" && "bg-success-soft text-success",
                tone === "warning" && "bg-warning-soft text-warning",
                tone === "danger" && "bg-danger-soft text-danger",
                tone === "neutral" && "bg-ink/[0.06] text-ink-soft",
              )}
              aria-hidden
            >
              {CATEGORY_ICON[integration.category]}
            </div>
            <div className="min-w-0 flex-1">
              <Eyebrow>{integration.category}</Eyebrow>
              <h3 className="truncate text-base font-bold text-ink">{integration.name}</h3>
            </div>
            <Badge tone={isLive ? "tangerine" : "aqua"} size="sm">
              {isLive ? "Live" : "Mock"}
            </Badge>
          </div>

          <p className="text-sm leading-relaxed text-ink-soft">{integration.description}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone} dot>
              {HEALTH_LABEL[integration.status]}
            </Badge>
            <span className="text-xs text-muted">
              {integration.lastSync
                ? `Synced ${formatTimeAgo(integration.lastSync)}`
                : "Never synced"}
            </span>
          </div>

          {integration.errors.length > 0 && (
            <div className="rounded-2xl bg-danger-soft px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {integration.errors.length === 1 ? "Issue" : "Issues"}
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-danger/90">
                {integration.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-auto space-y-3 pt-1">
            <div className="flex items-center justify-between rounded-2xl bg-canvas px-3 py-2.5">
              <div>
                <label htmlFor={`mode-${integration.id}`} className="text-sm font-semibold text-ink">
                  Live mode
                </label>
                <p className="text-xs text-muted">
                  {isLive ? "Real credentials path" : "Mock is the safe default"}
                </p>
              </div>
              <Switch
                id={`mode-${integration.id}`}
                checked={isLive}
                onCheckedChange={handleToggleMode}
                label={`Toggle ${integration.name} live mode`}
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                leftIcon={<Plug className="h-4 w-4" />}
                onClick={() => setConfigureOpen(true)}
              >
                Configure
              </Button>
              <Button
                variant="subtle"
                size="sm"
                className="flex-1"
                loading={testing}
                leftIcon={<Activity className="h-4 w-4" />}
                onClick={handleTest}
              >
                Test connection
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={configureOpen}
        onClose={() => setConfigureOpen(false)}
        title={`Configure ${integration.name}`}
        description="Demo placeholder — no real credentials are stored."
        footer={
          <Button variant="primary" size="sm" onClick={() => setConfigureOpen(false)}>
            Got it
          </Button>
        }
      >
        <div className="space-y-4 text-sm text-ink-soft">
          <div className="flex items-start gap-2.5 rounded-2xl bg-aqua-soft px-3.5 py-3 text-aqua">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              This integration runs in <strong>Mock mode</strong> by default. Hermes simulates
              {" "}
              {integration.category.toLowerCase()} calls so nothing leaves your machine.
            </p>
          </div>
          <div>
            <h4 className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              Wire up the real {integration.name}
            </h4>
            <ol className="ml-4 list-decimal space-y-1.5 text-ink-soft">
              <li>
                Add your {integration.name} API credentials to the server environment
                (<code className="rounded bg-ink/[0.06] px-1 py-0.5 font-mono text-xs">.env.local</code>).
              </li>
              <li>
                Implement the live adapter in{" "}
                <code className="rounded bg-ink/[0.06] px-1 py-0.5 font-mono text-xs">
                  src/lib/integrations.ts
                </code>
                .
              </li>
              <li>Toggle this card to Live mode and run Test connection to verify.</li>
            </ol>
          </div>
          <p className="text-xs text-muted">
            Everything in this build is dry-run. No outreach, money, or candidate data is ever
            sent for real.
          </p>
        </div>
      </Modal>
    </>
  );
}
