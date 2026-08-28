"use client";

import * as React from "react";
import { Button, Card, CardContent, Field, Input, Select, useToast } from "@/components/ui";
import { useActions, useApiKeys, useLlmProviders, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import type { CloudflareSettings } from "@/lib/types";
import { CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL } from "@/lib/integrations/cloudflare-workers-ai";
import { Cloud, Link2, Unlink } from "lucide-react";

/**
 * Connect Cloudflare Workers AI for agent/chat/outreach LLM tasks.
 * Stores the API token in the vault and account id in cloudflare_connections.
 */
export function CloudflareAgentPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_keys");
  const actions = useActions();
  const apiKeys = useApiKeys();
  const llmProviders = useLlmProviders();
  const { toast } = useToast();

  const [config, setConfig] = React.useState<CloudflareSettings | undefined>();
  const [loadingConfig, setLoadingConfig] = React.useState(true);
  const connected = !!config?.connected;

  const [accountId, setAccountId] = React.useState(config?.accountId ?? "");
  const [apiToken, setApiToken] = React.useState("");
  const [defaultModel, setDefaultModel] = React.useState(
    config?.defaultModel ?? CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL,
  );
  const [connecting, setConnecting] = React.useState(false);

  const loadConfig = React.useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/cloudflare/config", { cache: "no-store" });
      const body = (await response.json().catch(() => ({ ok: false }))) as {
        ok?: boolean;
        configured?: boolean;
        config?: CloudflareSettings | null;
      };
      setConfig(body.ok && body.configured && body.config ? body.config : undefined);
    } catch {
      setConfig(undefined);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  React.useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  React.useEffect(() => {
    setAccountId(config?.accountId ?? "");
    setDefaultModel(config?.defaultModel ?? CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL);
  }, [config?.accountId, config?.defaultModel]);

  const modelOptions = React.useMemo(() => {
    const fromServer = config?.models ?? [];
    const merged = new Set([defaultModel, CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL, ...fromServer]);
    return [...merged].filter(Boolean).map((m) => ({ value: m, label: m }));
  }, [config?.models, defaultModel]);

  async function handleConnect() {
    if (!accountId.trim() || !apiToken.trim()) {
      toast({ title: "Account ID and API token required", variant: "warning" });
      return;
    }
    setConnecting(true);
    const res = await actions.connectCloudflare(accountId.trim(), apiToken.trim(), defaultModel.trim());
    setConnecting(false);
    if (res.ok) {
      await loadConfig();
      setApiToken("");
      toast({
        title: "Cloudflare connected",
        description: "Workers AI is available for chat, outreach, and agent tasks.",
        variant: "success",
      });
    } else {
      toast({ title: "Couldn't connect Cloudflare", description: res.error, variant: "error" });
    }
  }

  async function handleDisconnect() {
    const result = await actions.disconnectCloudflare();
    if (!result.ok) {
      toast({ title: "Couldn't disconnect Cloudflare", description: result.error, variant: "error" });
      return;
    }
    setConfig(undefined);
    setApiToken("");
    toast({
      title: "Cloudflare disconnected",
      description: "The vault key remains in Access & Keys until you remove it.",
      variant: "info",
    });
  }

  const linkedKey = config?.apiKeyId
    ? apiKeys.find((k) => k.id === config.apiKeyId)
    : undefined;
  const providerRegistered = llmProviders.some((p) => p.kind === "Cloudflare Workers AI");

  if (loadingConfig) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted">Loading Cloudflare configuration…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
            <Cloud className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-ink">Cloudflare Workers AI</h3>
            <p className="mt-1 text-xs text-muted">
              Run recruiting agents on Cloudflare&apos;s edge LLMs. Create an API token with{" "}
              <span className="font-medium">Workers AI Read</span> (or Account → Workers AI) and paste your account id
              from the Cloudflare dashboard URL.
            </p>
          </div>
        </div>

        {connected ? (
          <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-ink">Connected</span>
              <span className="text-muted">account {config?.accountId}</span>
              {linkedKey && (
                <span className="text-muted">· key ••••{linkedKey.last4}</span>
              )}
              {providerRegistered && (
                <span className="text-muted">· listed in AI providers</span>
              )}
            </div>
            <Field label="Default model" htmlFor="cf-default-model">
              <Select
                id="cf-default-model"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                options={modelOptions}
                disabled={!isAdmin}
              />
            </Field>
            {isAdmin && (
              <Button type="button" variant="outline" size="sm" leftIcon={<Unlink className="h-4 w-4" />} onClick={() => void handleDisconnect()}>
                Disconnect
              </Button>
            )}
          </div>
        ) : isAdmin ? (
          <div className="space-y-3 rounded-2xl border border-dashed border-line p-4">
            <Field
              label="Cloudflare account ID"
              htmlFor="cf-account-id"
              hint="32-character hex id from dash.cloudflare.com (sidebar or URL)."
            >
              <Input
                id="cf-account-id"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="a1b2c3d4e5f6…"
                autoComplete="off"
              />
            </Field>
            <Field
              label="API token"
              htmlFor="cf-api-token"
              hint="Never shown again after connect — stored encrypted in the vault."
            >
              <Input
                id="cf-api-token"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Cloudflare API token"
                autoComplete="off"
              />
            </Field>
            <Field label="Default model" htmlFor="cf-model-new">
              <Input
                id="cf-model-new"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder={CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL}
              />
            </Field>
            <Button
              type="button"
              leftIcon={<Link2 className="h-4 w-4" />}
              disabled={connecting}
              onClick={() => void handleConnect()}
            >
              {connecting ? "Connecting…" : "Connect Cloudflare"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">Ask a workspace admin to connect Cloudflare Workers AI.</p>
        )}
      </CardContent>
    </Card>
  );
}
