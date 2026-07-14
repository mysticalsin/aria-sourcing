"use client";

import * as React from "react";
import { Button, Card, CardContent, Field, Input, Select, useToast } from "@/components/ui";
import { useActions, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { DUST_TASKS, type DustRegion, type DustSettings, type DustTask } from "@/lib/types";
import { Link2, Unlink, Zap } from "lucide-react";

const TASK_LABEL: Record<DustTask, string> = {
  jdAnalysis: "JD analysis",
  companyResearch: "Company research",
};

const TASK_DESCRIPTION: Record<DustTask, string> = {
  jdAnalysis: "Enriches the intake brief with the locked agent's read of the raw job description.",
  companyResearch: "Reserved for a future company-research enrichment step.",
};

/**
 * Settings panel for the Dust (dust.tt) agent-platform integration. Disconnected
 * state is a "paste workspace id + API key, click Connect" form (Dust has no
 * self-serve OAuth login flow). Connected state shows the workspace, a snapshot
 * of the workspace's agents, and a per-task lock table — matching Tony's ask to
 * "pick and lock the agents that will run task". No secrets ever round-trip back
 * to the browser; only the last-known agent names/ids are cached client-side.
 */
export function DustAgentPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_keys");
  const actions = useActions();
  const { toast } = useToast();
  const [dust, setDust] = React.useState<DustSettings>();
  const [loadingConfig, setLoadingConfig] = React.useState(true);
  const connected = !!dust?.connected;

  const [workspaceId, setWorkspaceId] = React.useState(dust?.workspaceId ?? "");
  const [region, setRegion] = React.useState<DustRegion>(dust?.region ?? "us");
  const [apiKey, setApiKey] = React.useState("");
  const [connecting, setConnecting] = React.useState(false);

  const loadConfig = React.useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/dust/config", { cache: "no-store" });
      const body = (await response.json().catch(() => ({ ok: false }))) as {
        ok?: boolean;
        configured?: boolean;
        config?: DustSettings | null;
      };
      setDust(body.ok && body.configured && body.config ? body.config : undefined);
    } catch {
      setDust(undefined);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  React.useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // Keep the workspace-id/region fields in sync if settings load/change after mount
  // (e.g. a teammate connects Dust and this workspace document refreshes).
  React.useEffect(() => {
    setWorkspaceId(dust?.workspaceId ?? "");
    setRegion(dust?.region ?? "us");
  }, [dust?.workspaceId, dust?.region]);

  async function handleConnect() {
    if (!workspaceId.trim() || !apiKey.trim()) {
      toast({ title: "Workspace ID and API key required", variant: "warning" });
      return;
    }
    setConnecting(true);
    const res = await actions.connectDust(workspaceId.trim(), apiKey.trim(), region);
    setConnecting(false);
    if (res.ok) {
      await loadConfig();
      setApiKey(""); // never retain the secret in the form
      toast({
        title: "Dust connected",
        description: "Lock an agent to each task below.",
        variant: "success",
      });
    } else {
      toast({ title: "Couldn't connect to Dust", description: res.error, variant: "error" });
    }
  }

  async function handleDisconnect() {
    const result = await actions.disconnectDust();
    if (!result.ok) {
      toast({ title: "Couldn't disconnect Dust", description: result.error, variant: "error" });
      return;
    }
    setDust(undefined);
    setApiKey("");
    toast({
      title: "Dust disconnected",
      description: "The vault key was left in place. Remove it from Access & Keys if no longer needed.",
      variant: "info",
    });
  }

  async function handleAgentLock(task: DustTask, agentSId: string) {
    const result = await actions.updateDustAgentLock(task, agentSId);
    if (!result.ok) {
      toast({ title: "Couldn't save the Dust agent lock", description: result.error, variant: "error" });
      return;
    }
    await loadConfig();
  }

  const agentOptions = (dust?.agents ?? []).map((a) => ({ value: a.sId, label: a.name }));

  if (loadingConfig) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted">Loading Dust configuration…</p>
        </CardContent>
      </Card>
    );
  }

  if (!connected) {
    return (
      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            Connect a Dust (dust.tt) workspace to delegate recruiting tasks to your own agents. Dust
            has no self-serve login flow. Paste the workspace ID and an API key from{" "}
            <span className="font-medium text-ink">Dust → Settings → API Keys</span>, then hit Connect.
          </p>
          {!isAdmin ? (
            <p className="text-xs text-muted">Admins only. Contact your workspace admin to connect Dust.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Workspace ID" htmlFor="dust-workspace">
                  <Input
                    id="dust-workspace"
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    placeholder="e.g. abc123"
                  />
                </Field>
                <Field label="Region" htmlFor="dust-region" hint="From your Dust URL: app.dust.tt (US) or eu.dust.tt (EU).">
                  <Select
                    id="dust-region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value as DustRegion)}
                    options={[
                      { value: "us", label: "US (dust.tt)" },
                      { value: "eu", label: "EU (eu.dust.tt)" },
                    ]}
                  />
                </Field>
                <Field label="API key" htmlFor="dust-key" hint="Stored encrypted server-side (never returned to the browser).">
                  <Input
                    id="dust-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your Dust API key"
                  />
                </Field>
              </div>
              <Button
                variant="primary"
                size="sm"
                loading={connecting}
                leftIcon={<Link2 className="h-4 w-4" />}
                onClick={handleConnect}
              >
                Connect Dust
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-success-soft px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-success">Connected</p>
            <p className="text-xs text-success/80">
              Workspace <span className="font-mono">{dust.workspaceId}</span> ({(dust.region ?? "us").toUpperCase()}) ·{" "}
              {(dust.agents ?? []).length} agent{(dust.agents ?? []).length === 1 ? "" : "s"} available
            </p>
          </div>
          {isAdmin && (
            <Button variant="subtle" size="sm" leftIcon={<Unlink className="h-4 w-4" />} onClick={() => void handleDisconnect()}>
              Disconnect
            </Button>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Task → agent locks</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {DUST_TASKS.map((task) => (
              <li key={task} className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{TASK_LABEL[task]}</span>
                  <span className="block text-xs text-muted">{TASK_DESCRIPTION[task]}</span>
                </div>
                <div className="w-full sm:w-64">
                  <Select
                    id={`dust-lock-${task}`}
                    aria-label={`Agent locked to ${TASK_LABEL[task]}`}
                    value={dust.agentLocks?.[task] ?? ""}
                    onChange={(e) => void handleAgentLock(task, e.target.value)}
                    disabled={!isAdmin || agentOptions.length === 0}
                    options={[{ value: "", label: "(none locked)" }, ...agentOptions]}
                  />
                </div>
              </li>
            ))}
          </ul>
          {agentOptions.length === 0 && (
            <p className="text-xs text-muted">
              No agents came back on the last connection test. Reconnect below once you've published an
              agent in this Dust workspace.
            </p>
          )}
        </div>

        {isAdmin && (
          <div className="border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Reconnect / rotate key
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
              <Field label="Workspace ID" htmlFor="dust-workspace-reconnect">
                <Input id="dust-workspace-reconnect" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
              </Field>
              <Field label="Region" htmlFor="dust-region-reconnect">
                <Select
                  id="dust-region-reconnect"
                  value={region}
                  onChange={(e) => setRegion(e.target.value as DustRegion)}
                  options={[
                    { value: "us", label: "US" },
                    { value: "eu", label: "EU" },
                  ]}
                />
              </Field>
              <Field
                label="API key"
                htmlFor="dust-key-reconnect"
                hint="Re-enter to refresh the agent list or rotate the key."
              >
                <Input
                  id="dust-key-reconnect"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your Dust API key"
                />
              </Field>
              <Button variant="outline" size="sm" loading={connecting} leftIcon={<Zap className="h-4 w-4" />} onClick={handleConnect}>
                Reconnect
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
