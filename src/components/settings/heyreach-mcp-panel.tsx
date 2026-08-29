"use client";

import * as React from "react";
import {
  Button,
  Field,
  Input,
  Select,
  useToast,
} from "@/components/ui";
import { useActions, useApiKeys, useMcpServers, useRole, useSeats, useSettings } from "@/lib/store";
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
import { heyReachSettingsReady } from "@/lib/heyreach-config";
import type { HeyReachSettings, McpAuthStyle } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ConnectedIdentityBanner,
  ConnectionStep,
  type StepState,
} from "@/components/settings/integration-connection-primitives";
import { CheckCircle2, ExternalLink, KeyRound, Megaphone, PlugZap, Save, Unplug } from "lucide-react";

export function useHeyReachMcp() {
  const role = useRole();
  const isAdmin = can(role, "manage_tools");
  const actions = useActions();
  const apiKeys = useApiKeys();
  const mcpServers = useMcpServers();
  const seats = useSeats();
  const settings = useSettings();
  const { toast } = useToast();

  const existing = React.useMemo(() => findHeyReachMcpServer(mcpServers), [mcpServers]);
  const connected = heyReachMcpConnected(existing);
  const keyOptions = React.useMemo(() => heyReachApiKeys(apiKeys), [apiKeys]);
  const heyReachSeat = React.useMemo(
    () => seats.find((s) => s.provider === "HeyReach" && s.status === "active"),
    [seats],
  );
  const savedApi = settings.heyreach;
  const apiDeliveryReady = heyReachSettingsReady(savedApi);

  const [url, setUrl] = React.useState(existing?.url ?? "");
  const [apiKeyId, setApiKeyId] = React.useState(existing?.apiKeyId ?? savedApi?.apiKeyId ?? "");
  const [authStyle, setAuthStyle] = React.useState<McpAuthStyle>(existing?.authStyle ?? "bearer");
  const [connecting, setConnecting] = React.useState(false);

  const [newApiKey, setNewApiKey] = React.useState("");
  const [campaignId, setCampaignId] = React.useState(savedApi?.campaignId ?? "");
  const [accountId, setAccountId] = React.useState(savedApi?.accountId ?? "");
  const [savingApi, setSavingApi] = React.useState(false);

  React.useEffect(() => {
    if (existing) {
      setUrl(existing.url);
      setApiKeyId(existing.apiKeyId ?? "");
      setAuthStyle(existing.authStyle ?? "bearer");
    }
  }, [existing?.id, existing?.url, existing?.apiKeyId, existing?.authStyle]);

  React.useEffect(() => {
    if (savedApi?.campaignId) setCampaignId(savedApi.campaignId);
    if (savedApi?.accountId !== undefined) setAccountId(savedApi.accountId ?? "");
    if (savedApi?.apiKeyId && !apiKeyId) setApiKeyId(savedApi.apiKeyId);
  }, [savedApi?.apiKeyId, savedApi?.campaignId, savedApi?.accountId]);

  async function ensureHeyReachSeatLive(): Promise<"created" | "live" | "unchanged" | "failed"> {
    if (!can(role, "manage_fleet")) return "unchanged";
    let seat = heyReachSeat;
    if (!seat) {
      const created = await actions.addSeat({
        name: "HeyReach LinkedIn",
        operatorEmail: "heyreach@aria.local",
        provider: "HeyReach",
        dailyLimit: 40,
        warmup: true,
        connectedAccount: "HeyReach",
      });
      if (!created) return "failed";
      seat = created;
      const live = await actions.toggleSeatLive(seat.id);
      return live.ok ? "created" : "failed";
    }
    if (seat.mode !== "live") {
      const live = await actions.toggleSeatLive(seat.id);
      return live.ok ? "live" : "failed";
    }
    return "unchanged";
  }

  async function resolveOrSaveApiKey(): Promise<string | null> {
    const pasted = newApiKey.trim();
    if (pasted) {
      if (!can(role, "manage_keys")) {
        toast({
          title: "Cannot save API key",
          description: "You need Access & Keys permission to store a HeyReach key.",
          variant: "error",
        });
        return null;
      }
      const saved = await actions.saveApiKey({
        name: `HeyReach ${new Date().toISOString().slice(0, 10)}`,
        provider: "HeyReach",
        value: pasted,
      });
      if (!saved.ok || !saved.key) {
        toast({
          title: "Could not save HeyReach key",
          description: saved.error ?? "Encrypt/store failed.",
          variant: "error",
        });
        return null;
      }
      setNewApiKey("");
      setApiKeyId(saved.key.id);
      return saved.key.id;
    }
    if (apiKeyId) return apiKeyId;
    return null;
  }

  async function saveApiDelivery() {
    const trimmedCampaign = campaignId.trim();
    if (!trimmedCampaign) {
      toast({
        title: "Campaign id required",
        description: "Paste your HeyReach campaign id (from HeyReach → Campaigns).",
        variant: "error",
      });
      return;
    }

    setSavingApi(true);
    try {
      const keyId = await resolveOrSaveApiKey();
      if (!keyId) {
        toast({
          title: "HeyReach API key required",
          description: "Paste a new key below or select a saved HeyReach key.",
          variant: "error",
        });
        return;
      }

      const next: HeyReachSettings = {
        apiKeyId: keyId,
        campaignId: trimmedCampaign,
        accountId: accountId.trim() || undefined,
        connected: true,
      };
      const persisted = await actions.updateSettingsPersisted({ heyreach: next });
      if (!persisted) {
        toast({
          title: "Could not save HeyReach settings",
          description: "Workspace write failed. Retry when the workspace is ready.",
          variant: "error",
        });
        return;
      }

      const seatOutcome = await ensureHeyReachSeatLive();
      actions.updateIntegration(HEYREACH_MCP_INTEGRATION_ID, {
        status: "connected",
        mode: "live",
        lastSync: new Date().toISOString(),
        errors: [],
        connectedAccount: connected ? HEYREACH_MCP_SERVER_NAME : "HeyReach API",
      });

      const seatNote =
        seatOutcome === "created"
          ? " Live HeyReach fleet seat created."
          : seatOutcome === "live"
            ? " HeyReach fleet seat set live."
            : seatOutcome === "failed"
              ? " Create a HeyReach seat in Fleet if durable queue is needed."
              : "";

      toast({
        title: "HeyReach API saved",
        description: `Campaign ${trimmedCampaign} linked for LinkedIn delivery.${seatNote}`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unexpected error.",
        variant: "error",
      });
    } finally {
      setSavingApi(false);
    }
  }

  async function connectHeyReach() {
    const trimmedUrl = url.trim();
    const guard = validateHeyReachMcpUrl(trimmedUrl);
    if (!guard.ok) {
      toast({ title: "Invalid HeyReach MCP URL", description: guard.error, variant: "error" });
      return;
    }

    setConnecting(true);
    try {
      const keyId = await resolveOrSaveApiKey();
      if (!keyId) {
        toast({
          title: "HeyReach key required",
          description: "Paste an API/MCP key below or select a saved key.",
          variant: "error",
        });
        return;
      }

      let serverId = existing?.id;
      if (existing) {
        actions.updateMcpServer(existing.id, {
          name: HEYREACH_MCP_SERVER_NAME,
          url: trimmedUrl,
          apiKeyId: keyId,
          authStyle,
          preset: "heyreach",
          enabled: false,
          status: "untested",
        });
      } else {
        const created = actions.addMcpServer({
          name: HEYREACH_MCP_SERVER_NAME,
          url: trimmedUrl,
          apiKeyId: keyId,
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

      // Persist campaign id if the operator already filled it (API path).
      if (campaignId.trim()) {
        const persisted = await actions.updateSettingsPersisted({
          heyreach: {
            apiKeyId: keyId,
            campaignId: campaignId.trim(),
            accountId: accountId.trim() || undefined,
            connected: true,
          },
        });
        if (!persisted) {
          toast({
            title: "MCP connected, but campaign id did not persist",
            description: "Retry Save HeyReach API when the workspace is ready.",
            variant: "warning",
          });
        }
      }

      const seatOutcome = await ensureHeyReachSeatLive();
      const seatNote =
        seatOutcome === "created"
          ? " Live HeyReach fleet seat created for durable LinkedIn queue."
          : seatOutcome === "live"
            ? " HeyReach fleet seat set live."
            : seatOutcome === "failed"
              ? " Create a HeyReach seat in Fleet and set it live for durable queue."
              : "";

      toast({
        title: "HeyReach MCP connected",
        description: `${test.toolCount ?? 0} tools available.${seatNote}${
          campaignId.trim() ? "" : " Add a campaign id below for autopilot LinkedIn send."
        }`,
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
      status: apiDeliveryReady ? "connected" : "not_configured",
      mode: "live",
      lastSync: null,
      errors: [],
      connectedAccount: apiDeliveryReady ? "HeyReach API" : undefined,
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
    heyReachSeatLive: heyReachSeat?.mode === "live",
    newApiKey,
    setNewApiKey,
    campaignId,
    setCampaignId,
    accountId,
    setAccountId,
    savingApi,
    saveApiDelivery,
    apiDeliveryReady,
    savedApi,
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
    heyReachSeatLive,
    newApiKey,
    setNewApiKey,
    campaignId,
    setCampaignId,
    accountId,
    setAccountId,
    savingApi,
    saveApiDelivery,
    apiDeliveryReady,
    savedApi,
  } = useHeyReachMcp();

  const ready = connected || apiDeliveryReady;
  const state: StepState =
    stepState ?? (ready ? "complete" : identityComplete ? "active" : "pending");

  return (
    <ConnectionStep
      step={2}
      title="Outreach — HeyReach API & MCP"
      subtitle="Add your HeyReach API key + campaign id here for LinkedIn delivery. Optionally connect HeyReach MCP for agent tools. No Fly CLI required."
      state={state}
    >
      {(connected && existing) || apiDeliveryReady ? (
        <ConnectedIdentityBanner
          displayName={connected && existing ? existing.name : "HeyReach API"}
          secondary={
            connected && existing
              ? `${existing.toolCount ?? 0} tools · ${existing.authStyle ?? "bearer"}${
                  heyReachSeatLive ? " · fleet seat live" : ""
                }${apiDeliveryReady ? ` · campaign ${savedApi?.campaignId}` : ""}`
              : `Campaign ${savedApi?.campaignId ?? "—"}${heyReachSeatLive ? " · fleet seat live" : ""}`
          }
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
          action={
            isAdmin && connected ? (
              <Button variant="ghost" size="sm" leftIcon={<Unplug className="h-3.5 w-3.5" />} onClick={disconnectHeyReach}>
                Disable MCP
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {isAdmin ? (
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">API delivery</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Paste HeyReach API key"
                htmlFor="heyreach-api-key-paste"
                hint="Encrypted in Access & Keys. Leave blank to reuse a saved key."
              >
                <Input
                  id="heyreach-api-key-paste"
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="HeyReach X-API-KEY…"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Or use saved key"
                htmlFor="heyreach-mcp-key"
                hint="Keys with provider HeyReach (or Custom)."
              >
                <Select
                  id="heyreach-mcp-key"
                  value={apiKeyId}
                  onChange={(e) => setApiKeyId(e.target.value)}
                  options={[
                    {
                      value: "",
                      label: keyOptions.length ? "Select a saved key…" : "No saved keys yet — paste one",
                    },
                    ...keyOptions.map((k) => ({ value: k.id, label: `${k.name} (••••${k.last4})` })),
                  ]}
                />
              </Field>
              <Field
                label="Campaign id"
                htmlFor="heyreach-campaign-id"
                hint="From HeyReach → Campaigns (required for LinkedIn send)."
              >
                <Input
                  id="heyreach-campaign-id"
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  placeholder="e.g. 12345"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Account id (optional)"
                htmlFor="heyreach-account-id"
                hint="LinkedIn sender account inside HeyReach."
              >
                <Input
                  id="heyreach-account-id"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="optional"
                  autoComplete="off"
                />
              </Field>
            </div>
            <Button
              leftIcon={<Save className="h-4 w-4" />}
              loading={savingApi}
              onClick={() => void saveApiDelivery()}
            >
              Save HeyReach API
            </Button>
          </div>

          <div className="space-y-3 border-t border-line pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">MCP tools (optional)</p>
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
            <div className="flex flex-wrap items-center gap-3">
              <Button
                leftIcon={connected ? <PlugZap className="h-4 w-4" /> : <Megaphone className="h-4 w-4" />}
                loading={connecting}
                onClick={() => void connectHeyReach()}
              >
                {connected ? "Reconnect & test MCP" : "Connect HeyReach MCP"}
              </Button>
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
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Admins add the HeyReach API key and MCP connection here. You can use the tools once connected.
        </p>
      )}

      <p className="flex items-start gap-2 text-[0.65rem] leading-relaxed text-muted">
        <KeyRound className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        Autopilot LinkedIn send uses the saved API key + campaign id (migration 0076 on Fly). MCP is the agent tool path.
        Dev MCP: <code className="font-mono">ARIA_ENABLE_REMOTE_MCP_EXECUTION=true</code>.
        Inbound: <code className="font-mono">POST /api/webhooks/linkedin</code>.
      </p>
    </ConnectionStep>
  );
}

/** @deprecated Prefer LinkedInOutreachStack — kept for direct import compatibility */
export function HeyReachMcpPanel() {
  return <HeyReachOutreachStep identityComplete />;
}
