"use client";

import * as React from "react";
import {
  Button,
  Field,
  Input,
  Select,
  useToast,
} from "@/components/ui";
import { useActions, useApiKeys, useMcpServers, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import {
  HEYREACH_HELP_URL,
  HEYREACH_MCP_INTEGRATION_ID,
  HEYREACH_MCP_SERVER_NAME,
  findHeyReachMcpServer,
  heyReachApiKeys,
  heyReachMcpConnected,
  validateHeyReachMcpUrl,
} from "@/lib/heyreach-mcp";
import type { McpAuthStyle } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ConnectedIdentityBanner,
  ConnectionStep,
  type StepState,
} from "@/components/settings/integration-connection-primitives";
import { CheckCircle2, ExternalLink, Megaphone, PlugZap, Unplug } from "lucide-react";

export function useHeyReachMcp() {
  const role = useRole();
  const isAdmin = can(role, "manage_tools");
  const actions = useActions();
  const apiKeys = useApiKeys();
  const mcpServers = useMcpServers();
  const { toast } = useToast();

  const existing = React.useMemo(() => findHeyReachMcpServer(mcpServers), [mcpServers]);
  const connected = heyReachMcpConnected(existing);
  const keyOptions = React.useMemo(() => heyReachApiKeys(apiKeys), [apiKeys]);

  const [url, setUrl] = React.useState(existing?.url ?? "");
  const [apiKeyId, setApiKeyId] = React.useState(existing?.apiKeyId ?? "");
  const [authStyle, setAuthStyle] = React.useState<McpAuthStyle>(existing?.authStyle ?? "bearer");
  const [connecting, setConnecting] = React.useState(false);

  React.useEffect(() => {
    if (existing) {
      setUrl(existing.url);
      setApiKeyId(existing.apiKeyId ?? "");
      setAuthStyle(existing.authStyle ?? "bearer");
    }
  }, [existing?.id, existing?.url, existing?.apiKeyId, existing?.authStyle]);

  async function connectHeyReach() {
    const trimmedUrl = url.trim();
    const guard = validateHeyReachMcpUrl(trimmedUrl);
    if (!guard.ok) {
      toast({ title: "Invalid HeyReach MCP URL", description: guard.error, variant: "error" });
      return;
    }
    if (!apiKeyId) {
      toast({
        title: "HeyReach key required",
        description: "Add a HeyReach MCP or API key under Access & Keys first.",
        variant: "error",
      });
      return;
    }

    setConnecting(true);
    try {
      let serverId = existing?.id;
      if (existing) {
        actions.updateMcpServer(existing.id, {
          name: HEYREACH_MCP_SERVER_NAME,
          url: trimmedUrl,
          apiKeyId,
          authStyle,
          preset: "heyreach",
          enabled: false,
          status: "untested",
        });
      } else {
        const created = actions.addMcpServer({
          name: HEYREACH_MCP_SERVER_NAME,
          url: trimmedUrl,
          apiKeyId,
          authStyle,
          preset: "heyreach",
          enabled: false,
        });
        serverId = created.id;
      }

      if (!serverId) {
        toast({ title: "Connect failed", description: "Could not register MCP server.", variant: "error" });
        return;
      }

      const test = await actions.testMcpServer(serverId);
      if (!test.ok) {
        actions.updateIntegration(HEYREACH_MCP_INTEGRATION_ID, {
          status: "error",
          mode: "live",
          lastSync: new Date().toISOString(),
          errors: [test.error ?? "MCP handshake failed"],
        });
        toast({
          title: "HeyReach MCP test failed",
          description: test.error ?? "Could not reach HeyReach MCP. Dev needs ARIA_ENABLE_REMOTE_MCP_EXECUTION=true.",
          variant: "error",
        });
        return;
      }

      actions.updateMcpServer(serverId, { enabled: true });
      actions.updateIntegration(HEYREACH_MCP_INTEGRATION_ID, {
        status: "connected",
        mode: "live",
        lastSync: new Date().toISOString(),
        errors: [],
        connectedAccount: HEYREACH_MCP_SERVER_NAME,
      });
      toast({
        title: "HeyReach MCP connected",
        description: `${test.toolCount ?? 0} tools available to agents for LinkedIn outreach.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Connect failed",
        description: err instanceof Error ? err.message : "Unexpected error.",
        variant: "error",
      });
    } finally {
      setConnecting(false);
    }
  }

  function disconnectHeyReach() {
    if (!existing) return;
    actions.updateMcpServer(existing.id, { enabled: false, status: "untested" });
    actions.updateIntegration(HEYREACH_MCP_INTEGRATION_ID, {
      status: "not_configured",
      mode: "live",
      lastSync: null,
      errors: [],
      connectedAccount: undefined,
    });
    toast({ title: "HeyReach MCP disabled", variant: "info" });
  }

  return {
    isAdmin,
    existing,
    connected,
    keyOptions,
    url,
    setUrl,
    apiKeyId,
    setApiKeyId,
    authStyle,
    setAuthStyle,
    connecting,
    connectHeyReach,
    disconnectHeyReach,
  };
}

export function HeyReachOutreachStep({
  stepState,
  identityComplete,
}: {
  stepState?: StepState;
  identityComplete?: boolean;
}) {
  const {
    isAdmin,
    existing,
    connected,
    keyOptions,
    url,
    setUrl,
    apiKeyId,
    setApiKeyId,
    authStyle,
    setAuthStyle,
    connecting,
    connectHeyReach,
    disconnectHeyReach,
  } = useHeyReachMcp();

  const state: StepState =
    stepState ?? (connected ? "complete" : identityComplete ? "active" : "pending");

  return (
    <ConnectionStep
      step={2}
      title="Outreach — HeyReach MCP"
      subtitle="Official MCP server for sequences, lists, and sends. Identity stays OIDC; execution goes through HeyReach."
      state={state}
    >
      {connected && existing ? (
        <ConnectedIdentityBanner
          displayName={existing.name}
          secondary={`${existing.toolCount ?? 0} tools · ${existing.authStyle ?? "bearer"}${existing.toolNames?.length ? ` · e.g. ${existing.toolNames.slice(0, 3).join(", ")}` : ""}`}
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
          action={
            isAdmin ? (
              <Button variant="ghost" size="sm" leftIcon={<Unplug className="h-3.5 w-3.5" />} onClick={disconnectHeyReach}>
                Disable
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {isAdmin ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="MCP connection URL"
            htmlFor="heyreach-mcp-url"
            hint="HeyReach → Integrations → HeyReach MCP Server"
          >
            <Input
              id="heyreach-mcp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.heyreach.io/your-workspace"
              autoComplete="off"
            />
          </Field>
          <Field
            label="HeyReach key"
            htmlFor="heyreach-mcp-key"
            hint="Save under Access & Keys (provider HeyReach)."
          >
            <Select
              id="heyreach-mcp-key"
              value={apiKeyId}
              onChange={(e) => setApiKeyId(e.target.value)}
              options={[
                { value: "", label: keyOptions.length ? "Select a saved key…" : "No HeyReach keys — add one first" },
                ...keyOptions.map((k) => ({ value: k.id, label: `${k.name} (••••${k.last4})` })),
              ]}
            />
          </Field>
          <Field label="Auth style" htmlFor="heyreach-mcp-auth">
            <Select
              id="heyreach-mcp-auth"
              value={authStyle}
              onChange={(e) => setAuthStyle(e.target.value as McpAuthStyle)}
              options={[
                { value: "bearer", label: "Bearer (MCP key — default)" },
                { value: "x-api-key", label: "X-API-Key (REST API key)" },
              ]}
            />
          </Field>
        </div>
      ) : (
        <p className="text-xs text-muted">Admins connect HeyReach MCP here. You can use the tools once connected.</p>
      )}

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            leftIcon={connected ? <PlugZap className="h-4 w-4" /> : <Megaphone className="h-4 w-4" />}
            loading={connecting}
            disabled={!identityComplete && !connected}
            onClick={() => void connectHeyReach()}
          >
            {connected ? "Reconnect & test" : "Connect HeyReach MCP"}
          </Button>
          {!identityComplete && !connected ? (
            <p className="text-xs text-muted">Complete Step 1 (Sign in with LinkedIn) first, or use assisted-manual.</p>
          ) : null}
          <a
            href={HEYREACH_HELP_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline",
            )}
          >
            HeyReach MCP setup guide
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      )}

      <p className="text-[0.65rem] leading-relaxed text-muted">
        Dev: <code className="font-mono">ARIA_ENABLE_REMOTE_MCP_EXECUTION=true</code> before test.
        Production requires MCP allowlist. Inbound replies via{" "}
        <code className="font-mono">POST /api/webhooks/linkedin</code>.
      </p>
    </ConnectionStep>
  );
}

/** @deprecated Prefer LinkedInOutreachStack — kept for direct import compatibility */
export function HeyReachMcpPanel() {
  return <HeyReachOutreachStep identityComplete />;
}
