"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Field, Input, Select, Switch, useToast } from "@/components/ui";
import { useActions, useApiKeys, useMcpServers, useRole, useSettings } from "@/lib/store";
import type { McpServerConfig, McpServerStatus } from "@/lib/types";
import { can } from "@/lib/rbac";
import { Globe, Plug, Plus, Trash2, Zap } from "lucide-react";

const STATUS_TONE: Record<McpServerStatus, "neutral" | "success" | "danger"> = {
  untested: "neutral",
  connected: "success",
  error: "danger",
};

function McpRow({
  server,
  apiKeyOptions,
  isAdmin,
  onUpdate,
  onRemove,
  onTest,
}: {
  server: McpServerConfig;
  apiKeyOptions: { value: string; label: string }[];
  isAdmin: boolean;
  onUpdate: (patch: Partial<McpServerConfig>) => void;
  onRemove: () => void;
  onTest: () => Promise<void>;
}) {
  const [testing, setTesting] = React.useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex items-start gap-3 sm:flex-1">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <Plug className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{server.name}</span>
            <Badge tone={STATUS_TONE[server.status]} size="sm">
              {server.status}
            </Badge>
            {server.toolCount != null && (
              <span className="text-xs text-muted">{server.toolCount} tools</span>
            )}
          </div>
          <p className="truncate text-xs text-muted" title={server.url}>
            {server.url}
          </p>
          {server.toolNames && server.toolNames.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {server.toolNames.slice(0, 12).map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-muted"
                  title={`Tool the fleet can call: ${t}`}
                >
                  {t}
                </span>
              ))}
              {server.toolNames.length > 12 && (
                <span className="text-[10px] text-muted">+{server.toolNames.length - 12} more</span>
              )}
            </div>
          )}
          {isAdmin && (
            <Field
              label="Auth key (optional)"
              htmlFor={`mcp-key-${server.id}`}
              hint="A saved key used as the Bearer token for this server."
            >
              <Select
                id={`mcp-key-${server.id}`}
                value={server.apiKeyId ?? ""}
                onChange={(e) => onUpdate({ apiKeyId: e.target.value || undefined })}
                options={[{ value: "", label: "(none)" }, ...apiKeyOptions]}
              />
            </Field>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Switch
          id={`mcp-enable-${server.id}`}
          checked={server.enabled}
          onCheckedChange={(v) => onUpdate({ enabled: v })}
          label={server.enabled ? "Enabled" : "Disabled"}
          disabled={!isAdmin}
        />
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            disabled={testing}
            leftIcon={<Zap className="h-3.5 w-3.5" />}
            onClick={async () => {
              setTesting(true);
              await onTest();
              setTesting(false);
            }}
          >
            {testing ? "Testing…" : "Test"}
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={onRemove}
            title="Remove MCP server"
          />
        )}
      </div>
    </div>
  );
}

export function McpServersPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_tools");
  const servers = useMcpServers();
  const apiKeys = useApiKeys();
  const settings = useSettings();
  const actions = useActions();
  const { toast } = useToast();
  const webResearch = settings.webResearch !== false;

  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const apiKeyOptions = apiKeys.map((k) => ({ value: k.id, label: `${k.name} (••••${k.last4})` }));

  function handleAdd() {
    const n = name.trim();
    const u = url.trim();
    if (!n || !u) {
      toast({ title: "Name and URL are required", variant: "error" });
      return;
    }
    actions.addMcpServer({ name: n, url: u, enabled: false });
    toast({ title: `MCP server added: ${n}`, description: "Test the connection to confirm it works.", variant: "success" });
    setName("");
    setUrl("");
    setAdding(false);
  }

  async function handleTest(id: string, label: string) {
    const res = await actions.testMcpServer(id);
    toast({
      title: res.ok ? `${label} connected` : `${label} failed`,
      description: res.ok ? "MCP handshake succeeded." : res.error ?? "Could not reach the server.",
      variant: res.ok ? "success" : "error",
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        {/* Built-in, read-only web-research capability. Compliant by design: honest bot
            User-Agent, no login/session/stealth, SSRF-guarded. Only active when a cloud
            LLM provider is configured for the chat task. */}
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex items-start gap-3 sm:flex-1">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Globe className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">Web research (built-in)</span>
                <Badge tone={webResearch ? "success" : "neutral"} size="sm">
                  {webResearch ? "on" : "off"}
                </Badge>
              </div>
              <p className="text-xs text-muted">
                Lets agents read the public web for research and sourcing signals: <code>web_search</code>, <code>fetch_page</code>, <code>rss</code>, and
                (when the Obscura sidecar is running) <code>browser_open</code> for JS-rendered pages a plain fetch can&apos;t
                read. Read-only and compliant: honest bot user-agent, no logins, no
                scraping behind auth, no bot-detection evasion, no form-filling; internal/private addresses are blocked.
                Active only when a cloud LLM provider is set for chat.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <Switch
              id="web-research-enable"
              checked={webResearch}
              onCheckedChange={(v) => actions.updateSettings({ webResearch: v })}
              label={webResearch ? "Enabled" : "Disabled"}
              disabled={!isAdmin}
            />
          </div>
        </div>

        {servers.length === 0 && (
          <p className="text-sm text-muted">No MCP servers connected. Add one to give the fleet more tools.</p>
        )}

        <div className="space-y-3">
          {servers.map((m) => (
            <McpRow
              key={m.id}
              server={m}
              apiKeyOptions={apiKeyOptions}
              isAdmin={isAdmin}
              onUpdate={(patch) => actions.updateMcpServer(m.id, patch)}
              onRemove={() => {
                actions.removeMcpServer(m.id);
                toast({ title: "MCP server removed", variant: "info" });
              }}
              onTest={() => handleTest(m.id, m.name)}
            />
          ))}
        </div>

        {isAdmin && (
          <div className="border-t border-line pt-4">
            {adding ? (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Name" htmlFor="new-mcp-name" className="min-w-[160px]">
                  <Input id="new-mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Apollo MCP" />
                </Field>
                <Field label="Server URL" htmlFor="new-mcp-url" className="min-w-[260px]">
                  <Input
                    id="new-mcp-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://mcp.example.com/mcp"
                  />
                </Field>
                <div className="flex gap-2 pb-1">
                  <Button size="sm" onClick={handleAdd}>
                    Add server
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                Add MCP server
              </Button>
            )}
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted">Admins only. Contact your workspace admin to connect MCP tool servers.</p>
        )}
      </CardContent>
    </Card>
  );
}
