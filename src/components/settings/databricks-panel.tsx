"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { can } from "@/lib/rbac";
import { useActions, useApiKeys, useRole, useSettings } from "@/lib/store";
import type { DatabricksSettings } from "@/lib/types";
import { Database, Unlink } from "lucide-react";

const DEFAULT_NEEDS_QUERY =
  "SELECT title, description, location, skills\n" +
  "FROM hiring_needs\n" +
  "WHERE updated_at >= :since\n" +
  "ORDER BY updated_at DESC";

function currentConfig(cfg?: DatabricksSettings): DatabricksSettings {
  return {
    host: cfg?.host ?? "",
    warehouseId: cfg?.warehouseId ?? "",
    authMode: cfg?.authMode ?? "pat",
    clientId: cfg?.clientId ?? "",
    apiKeyId: cfg?.apiKeyId ?? "",
    needsQuery: cfg?.needsQuery ?? DEFAULT_NEEDS_QUERY,
    sinceColumn: cfg?.sinceColumn ?? "",
  };
}

export function DatabricksPanel() {
  const settings = useSettings();
  const actions = useActions();
  const keys = useApiKeys().filter((key) => key.provider === "Databricks");
  const role = useRole();
  const isAdmin = can(role, "manage_settings");
  const { toast } = useToast();
  const cfg = currentConfig(settings.databricks);

  function patchDatabricks(patch: Partial<DatabricksSettings>) {
    actions.updateSettings({ databricks: { ...cfg, ...patch } });
  }

  function savedToast() {
    toast({ title: "Databricks settings saved", variant: "success" });
  }

  function disconnect() {
    actions.updateSettings({ databricks: undefined });
    toast({ title: "Databricks disconnected", variant: "info" });
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
          <Badge tone={settings.databricks ? "success" : "neutral"} size="sm" dot>
            {settings.databricks ? "configured" : "not configured"}
          </Badge>
        </div>

        {!isAdmin ? (
          <p className="text-xs text-muted">Admins only. Contact your workspace admin to configure Databricks intake.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Workspace host" htmlFor="databricks-host" hint="Public https URL only. Private/internal hosts are rejected server-side.">
                <Input
                  id="databricks-host"
                  value={cfg.host}
                  onChange={(event) => patchDatabricks({ host: event.target.value })}
                  onBlur={savedToast}
                  placeholder="https://dbc-example.cloud.databricks.com"
                />
              </Field>
              <Field label="Warehouse ID" htmlFor="databricks-warehouse">
                <Input
                  id="databricks-warehouse"
                  value={cfg.warehouseId}
                  onChange={(event) => patchDatabricks({ warehouseId: event.target.value })}
                  onBlur={savedToast}
                  placeholder="SQL warehouse id"
                />
              </Field>
              <Field label="Auth mode" htmlFor="databricks-auth">
                <Select
                  id="databricks-auth"
                  value={cfg.authMode}
                  onChange={(event) => {
                    patchDatabricks({ authMode: event.target.value as DatabricksSettings["authMode"] });
                    savedToast();
                  }}
                  options={[
                    { value: "pat", label: "PAT bearer" },
                    { value: "m2m", label: "OAuth M2M" },
                  ]}
                />
              </Field>
              <Field label="Stored key" htmlFor="databricks-key" hint={cfg.authMode === "m2m" ? "OAuth client secret." : "Personal access token."}>
                <Select
                  id="databricks-key"
                  value={cfg.apiKeyId}
                  onChange={(event) => {
                    patchDatabricks({ apiKeyId: event.target.value });
                    savedToast();
                  }}
                  options={keyOptions}
                />
              </Field>
              {cfg.authMode === "m2m" && (
                <Field label="OAuth client ID" htmlFor="databricks-client-id" className="md:col-span-2">
                  <Input
                    id="databricks-client-id"
                    value={cfg.clientId ?? ""}
                    onChange={(event) => patchDatabricks({ clientId: event.target.value })}
                    onBlur={savedToast}
                    placeholder="Databricks service principal client id"
                  />
                </Field>
              )}
            </div>

            <Field label="Needs query" htmlFor="databricks-needs-query" hint="Must use the :since TIMESTAMP parameter. The server sends it separately, never interpolated.">
              <Textarea
                id="databricks-needs-query"
                rows={7}
                value={cfg.needsQuery}
                onChange={(event) => patchDatabricks({ needsQuery: event.target.value })}
                onBlur={savedToast}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </Field>

            {settings.databricks && (
              <Button variant="outline" size="sm" leftIcon={<Unlink className="h-4 w-4" />} onClick={disconnect}>
                Disconnect Databricks
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
