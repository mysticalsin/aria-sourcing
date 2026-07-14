"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { can } from "@/lib/rbac";
import { useApiKeys, useRole } from "@/lib/store";
import type { DatabricksSettings } from "@/lib/types";
import { Database, Save, Unlink } from "lucide-react";

const CONFIG_ENDPOINT = "/api/integrations/databricks/config";
const DEFAULT_NEEDS_QUERY =
  "SELECT title, description, location, skills\n" +
  "FROM hiring_needs\n" +
  "WHERE updated_at >= :since\n" +
  "ORDER BY updated_at DESC";

interface DatabricksConfigView extends DatabricksSettings {
  id: string;
  enabled: boolean;
  configRevision: number;
  updatedAt: string;
}

type ConfigApiResponse = {
  ok?: boolean;
  configured?: boolean;
  config?: DatabricksConfigView | null;
  error?: string;
};

function emptyConfig(): DatabricksSettings {
  return {
    host: "",
    warehouseId: "",
    authMode: "pat",
    clientId: "",
    apiKeyId: "",
    needsQuery: DEFAULT_NEEDS_QUERY,
  };
}

function editableConfig(config: DatabricksConfigView | null | undefined): DatabricksSettings {
  if (!config) return emptyConfig();
  return {
    host: config.host,
    warehouseId: config.warehouseId,
    authMode: config.authMode,
    clientId: config.clientId ?? "",
    apiKeyId: config.apiKeyId,
    needsQuery: config.needsQuery,
  };
}

export function DatabricksPanel() {
  const keys = useApiKeys().filter((key) => key.provider === "Databricks");
  const role = useRole();
  const isAdmin = can(role, "manage_settings");
  const { toast } = useToast();
  const [config, setConfig] = React.useState<DatabricksSettings>(() => emptyConfig());
  const [configured, setConfigured] = React.useState(false);
  const [loading, setLoading] = React.useState(isAdmin);
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);

  React.useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(CONFIG_ENDPOINT, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as ConfigApiResponse | null;
        if (!response.ok || !body?.ok) {
          throw new Error(body?.error ?? "Databricks configuration could not be loaded.");
        }
        if (controller.signal.aborted) return;
        setConfigured(body.configured === true);
        setConfig(editableConfig(body.config));
      } catch (error) {
        if (controller.signal.aborted) return;
        toast({
          title: "Could not load Databricks settings",
          description: error instanceof Error ? error.message : "Try again.",
          variant: "error",
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [isAdmin, toast]);

  function patchConfig(patch: Partial<DatabricksSettings>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  async function saveConfig() {
    if (!config.host.trim() || !config.warehouseId.trim() || !config.apiKeyId || !config.needsQuery.trim()) {
      toast({ title: "Complete the Databricks configuration", variant: "warning" });
      return;
    }
    if (config.authMode === "m2m" && !config.clientId?.trim()) {
      toast({ title: "OAuth client ID is required", variant: "warning" });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(CONFIG_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...config,
          host: config.host.trim(),
          warehouseId: config.warehouseId.trim(),
          clientId: config.authMode === "m2m" ? config.clientId?.trim() : undefined,
          needsQuery: config.needsQuery.trim(),
        }),
      });
      const body = (await response.json().catch(() => null)) as ConfigApiResponse | null;
      if (!response.ok || !body?.ok || !body.config) {
        throw new Error(body?.error ?? "Databricks configuration could not be saved.");
      }
      setConfigured(true);
      setConfig(editableConfig(body.config));
      toast({ title: "Databricks settings saved", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not save Databricks settings",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const response = await fetch(CONFIG_ENDPOINT, { method: "DELETE", headers: { Accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as ConfigApiResponse | null;
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error ?? "Databricks configuration could not be removed.");
      }
      setConfigured(false);
      setConfig(emptyConfig());
      toast({ title: "Databricks disconnected", variant: "info" });
    } catch (error) {
      toast({
        title: "Could not disconnect Databricks",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "error",
      });
    } finally {
      setDisconnecting(false);
    }
  }

  const keyOptions = [
    { value: "", label: keys.length ? "Choose a Databricks key" : "No Databricks key saved" },
    ...keys.map((key) => ({ value: key.id, label: `${key.name} (....${key.last4})` })),
  ];

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink/[0.05] text-ink-soft" aria-hidden>
              <Database className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ink">Databricks intake</h3>
              <p className="mt-0.5 text-xs text-muted">
                Statement Execution imports hiring needs as proposed intake drafts.
              </p>
            </div>
          </div>
          <Badge tone={configured ? "success" : "neutral"} size="sm" dot>
            {loading ? "checking" : configured ? "configured" : isAdmin ? "not configured" : "admin managed"}
          </Badge>
        </div>

        {!isAdmin ? (
          <p className="text-xs text-muted">Admins manage the approved Databricks origin and credential binding.</p>
        ) : (
          <div className="space-y-4" aria-busy={loading}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Workspace host" htmlFor="databricks-host" hint="Canonical public HTTPS origin, with no path or custom port.">
                <Input
                  id="databricks-host"
                  value={config.host}
                  onChange={(event) => patchConfig({ host: event.target.value })}
                  placeholder="https://dbc-example.cloud.databricks.com"
                  disabled={loading}
                />
              </Field>
              <Field label="Warehouse ID" htmlFor="databricks-warehouse">
                <Input
                  id="databricks-warehouse"
                  value={config.warehouseId}
                  onChange={(event) => patchConfig({ warehouseId: event.target.value })}
                  placeholder="SQL warehouse id"
                  disabled={loading}
                />
              </Field>
              <Field label="Auth mode" htmlFor="databricks-auth">
                <Select
                  id="databricks-auth"
                  value={config.authMode}
                  onChange={(event) => patchConfig({ authMode: event.target.value as DatabricksSettings["authMode"] })}
                  options={[
                    { value: "pat", label: "PAT bearer" },
                    { value: "m2m", label: "OAuth M2M" },
                  ]}
                  disabled={loading}
                />
              </Field>
              <Field label="Stored key" htmlFor="databricks-key" hint={config.authMode === "m2m" ? "OAuth client secret." : "Personal access token."}>
                <Select
                  id="databricks-key"
                  value={config.apiKeyId}
                  onChange={(event) => patchConfig({ apiKeyId: event.target.value })}
                  options={keyOptions}
                  disabled={loading}
                />
              </Field>
              {config.authMode === "m2m" && (
                <Field label="OAuth client ID" htmlFor="databricks-client-id" className="md:col-span-2">
                  <Input
                    id="databricks-client-id"
                    value={config.clientId ?? ""}
                    onChange={(event) => patchConfig({ clientId: event.target.value })}
                    placeholder="Databricks service principal client id"
                    disabled={loading}
                  />
                </Field>
              )}
            </div>

            <Field label="Needs query" htmlFor="databricks-needs-query" hint="Must use the :since TIMESTAMP parameter.">
              <Textarea
                id="databricks-needs-query"
                rows={7}
                value={config.needsQuery}
                onChange={(event) => patchConfig({ needsQuery: event.target.value })}
                spellCheck={false}
                className="font-mono text-xs"
                disabled={loading}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Save className="h-4 w-4" />}
                loading={saving}
                disabled={loading || disconnecting}
                onClick={saveConfig}
              >
                Save Databricks settings
              </Button>
              {configured && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Unlink className="h-4 w-4" />}
                  loading={disconnecting}
                  disabled={loading || saving}
                  onClick={disconnect}
                >
                  Disconnect Databricks
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
