"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Select,
  Switch,
  useToast,
} from "@/components/ui";
import { useActions, useApiKeys, useRole, useSettings } from "@/lib/store";
import { can } from "@/lib/rbac";
import { getHermesStatus, type HermesRuntimeStatus } from "@/lib/ai/hermes-runtime";
import { demoLoginEnabled } from "@/lib/supabase/config";
import { Bot, Plug, ShieldCheck, Activity } from "lucide-react";

/**
 * Aria runtime panel (admin-gated via manage_providers).
 * Connects the live NousResearch hermes-agent runtime for real LLM-backed
 * outreach drafting. The approval gate is unchanged — live drafts still require
 * human approval before any send. Demo tenants may fall back to mock drafting;
 * live enterprise tenants fail closed without a live runtime.
 */
export function HermesRuntimePanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_providers");
  const settings = useSettings();
  const apiKeys = useApiKeys();
  const actions = useActions();
  const { toast } = useToast();

  const [testing, setTesting] = React.useState(false);
  const [runtimeStatus, setRuntimeStatus] = React.useState<HermesRuntimeStatus | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(false);

  React.useEffect(() => {
    if (!settings.hermesLiveMode || !settings.hermesApiUrl) {
      setRuntimeStatus(null);
      return;
    }
    let cancelled = false;
    setStatusLoading(true);
    getHermesStatus(settings).then((res) => {
      if (cancelled) return;
      setStatusLoading(false);
      if (res.ok && res.data) setRuntimeStatus(res.data);
      else setRuntimeStatus(null);
    });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // Only keys registered under the "Aria Agent" provider are selectable.
  const hermesKeys = apiKeys.filter((k) => k.provider === "Aria Agent");
  const keyOptions = [
    { value: "", label: "None (uses env fallback)" },
    ...hermesKeys.map((k) => ({ value: k.id, label: `${k.name} (••••${k.last4})` })),
  ];

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/hermes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "chat",
          prompt: "ping",
          stream: false,
          hermesApiUrl: settings.hermesApiUrl ?? "",
          hermesApiKeyId: settings.hermesApiKeyId ?? "",
        }),
      });
      const json = (await res.json().catch(() => ({ ok: false, reason: "Bad response." }))) as {
        ok: boolean;
        reason?: string;
      };
      if (json.ok) {
        toast({ title: "Aria runtime reachable", description: "The agent responded.", variant: "success" });
      } else {
        toast({
          title: "Aria runtime unavailable",
          description: json.reason ?? "No response. Outreach will use the mock.",
          variant: "error",
        });
      }
    } catch (err) {
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : "Network error.",
        variant: "error",
      });
    } finally {
      setTesting(false);
    }
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardContent>
          <p className="text-xs text-muted">Admins only. Contact your workspace admin to configure the Aria runtime.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-line p-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink/[0.06] text-ink-soft" aria-hidden>
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Live mode</p>
              <p className="mt-0.5 text-xs text-muted">
                {demoLoginEnabled
                  ? "Route outreach drafting through the live Aria agent. Off uses the built-in mock. Either way, drafts still require human approval before any send."
                  : "Route outreach drafting through the live Aria agent. Live tenants require a configured runtime — mock drafting is disabled. Drafts still require human approval before any send."}
              </p>
            </div>
          </div>
          <Switch
            id="hermesLiveMode"
            checked={!!settings.hermesLiveMode}
            onCheckedChange={(v) => {
              actions.updateSettings({ hermesLiveMode: v });
              toast({ title: `Aria live mode ${v ? "enabled" : "disabled"}`, variant: v ? "success" : "info" });
            }}
            label="Aria live mode"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Runtime API URL"
            htmlFor="hermesApiUrl"
            hint="Enables the live runtime in this browser. The server resolves the real
              addresses from HERMES_API_URL and HERMES_WEB_URL and ignores anything sent
              from here, so a client cannot redirect the runtime (SSRF)."
          >
            <Input
              id="hermesApiUrl"
              value={settings.hermesApiUrl ?? ""}
              onChange={(e) => actions.updateSettings({ hermesApiUrl: e.target.value })}
              onBlur={() => toast({ title: "Settings saved", variant: "success" })}
              placeholder="http://127.0.0.1:8642"
            />
          </Field>
          <Field
            label="Bearer key"
            htmlFor="hermesApiKeyId"
            hint='A saved API key registered under the "Aria Agent" provider.'
          >
            <Select
              id="hermesApiKeyId"
              value={settings.hermesApiKeyId ?? ""}
              onChange={(e) => {
                actions.updateSettings({ hermesApiKeyId: e.target.value });
                toast({ title: "Settings saved", variant: "success" });
              }}
              options={keyOptions}
            />
          </Field>
        </div>

        {hermesKeys.length === 0 && (
          <p className="text-xs text-muted">
            No keys registered under the &ldquo;Aria Agent&rdquo; provider yet. Add one in{" "}
            <span className="font-medium text-ink-soft">API keys</span> above, or rely on the server{" "}
            <code className="rounded bg-ink/[0.06] px-1">HERMES_API_KEY</code> env fallback.
          </p>
        )}

        {settings.hermesLiveMode && (
          <div className="rounded-2xl border border-line bg-canvas px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
              <Activity className="h-3.5 w-3.5" aria-hidden />
              Runtime status
            </div>
            {statusLoading ? (
              <p className="mt-1.5 text-xs text-muted">Polling hermes-agent…</p>
            ) : runtimeStatus ? (
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted">Status</dt>
                  <dd className="font-medium text-ink">{String(runtimeStatus.status ?? "unknown")}</dd>
                </div>
                <div>
                  <dt className="text-muted">Version</dt>
                  <dd className="font-medium text-ink">{String(runtimeStatus.version ?? "N/A")}</dd>
                </div>
                <div>
                  <dt className="text-muted">Uptime</dt>
                  <dd className="font-medium text-ink">
                    {typeof runtimeStatus.uptime === "number" ? `${Math.round(runtimeStatus.uptime)}s` : "N/A"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-1.5 text-xs text-muted">Runtime not reachable. Check HERMES_API_URL and that hermes-agent is running.</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Plug className="h-4 w-4" />}
            onClick={handleTest}
            loading={testing}
          >
            Test connection
          </Button>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Text generation only. The runtime never sends; the approval gate still applies.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={settings.hermesLiveMode ? "success" : "neutral"} size="sm" dot>
            {settings.hermesLiveMode
              ? "Live drafting on"
              : demoLoginEnabled
                ? "Mock drafting"
                : "Live drafting required"}
          </Badge>
          <span className="text-xs text-muted">
            {demoLoginEnabled
              ? "Misconfiguration falls back to the mock automatically."
              : "Misconfiguration fails closed — no silent mock drafts on live tenants."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
