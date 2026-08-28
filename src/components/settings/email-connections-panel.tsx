"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Eyebrow,
  useToast,
} from "@/components/ui";
import { useActions, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
import {
  ConnectionListItem,
  SystemReadiness,
  type ReadinessItem,
} from "@/components/settings/integration-connection-primitives";
import {
  Activity,
  AlertTriangle,
  Link2,
  Mail,
  Plug,
  ShieldCheck,
  Unplug,
} from "lucide-react";

type ProviderReadiness = {
  gmailOAuth: boolean;
  microsoftOAuth: boolean;
  sendgridApiKey: boolean;
  resendApiKey: boolean;
  encryptionReady: boolean;
  inboundWebhookSecret: boolean;
  inboxPollAllowed?: boolean;
};

type ConnectionRow = {
  id: string;
  seatId: string;
  seatName: string | null;
  /** Fleet seat mode — confirmLive Teams books require "live". */
  seatMode?: string | null;
  provider: string;
  accountEmail: string;
  expiresAt: string | null;
  hasRefreshToken: boolean;
  scope: string;
  updatedAt: string | null;
  inboundRoute: { mailbox: string; purpose: string; active: boolean } | null;
  graphSubscription?: {
    status: string;
    expiresAt: string;
    lastNotificationAt: string | null;
    active: boolean;
  } | null;
};

type ConnectionsPayload = {
  ok?: boolean;
  demo?: boolean;
  detail?: string;
  error?: string;
  providers?: ProviderReadiness;
  connections?: ConnectionRow[];
};

function ReadinessFromProviders(providers: ProviderReadiness): ReadinessItem[] {
  return [
    {
      id: "gmail",
      label: "Gmail OAuth",
      ok: providers.gmailOAuth,
      hint: "Set Google OAuth client credentials in deployment env.",
    },
    {
      id: "outlook",
      label: "Outlook OAuth",
      ok: providers.microsoftOAuth,
      hint: "Set Microsoft Graph OAuth credentials in deployment env.",
    },
    {
      id: "encryption",
      label: "Token encryption",
      ok: providers.encryptionReady,
      hint: "DATA_ENCRYPTION_KEY (≥32 chars) required.",
    },
    {
      id: "webhook",
      label: "HMAC inbound secret",
      ok: providers.inboundWebhookSecret,
      optional: true,
      hint: "Optional signed POST /api/webhooks/email-inbound. Graph Outlook intake uses clientState after Connect Outlook.",
    },
    {
      id: "sendgrid",
      label: "SendGrid API key",
      ok: providers.sendgridApiKey,
      optional: true,
    },
    {
      id: "resend",
      label: "Resend API key",
      ok: providers.resendApiKey,
      optional: true,
    },
  ];
}

export const EMAIL_CONNECTIONS_PANEL_ID = "email-connections-panel";

export function EmailConnectionsPanel() {
  const actions = useActions();
  const role = useRole();
  const { toast } = useToast();
  const isAdmin = can(role, "manage_fleet");
  const [loading, setLoading] = React.useState(true);
  const [connecting, setConnecting] = React.useState<"Gmail API" | "Microsoft Graph" | null>(null);
  const [testingSeat, setTestingSeat] = React.useState<string | null>(null);
  const [ensuringWebhook, setEnsuringWebhook] = React.useState<string | null>(null);
  const [data, setData] = React.useState<ConnectionsPayload | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email/connections", { method: "GET", credentials: "include" });
      const json = (await res.json().catch(() => null)) as ConnectionsPayload | null;
      setData(json);
    } catch {
      setData({ ok: false, error: "Network error loading connections." });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function connect(provider: "Gmail API" | "Microsoft Graph") {
    if (!supabaseEnabled) {
      toast({
        title: "Live mode required",
        description: "Configure Supabase, then connect Gmail or Outlook here.",
        variant: "error",
      });
      return;
    }
    setConnecting(provider);
    try {
      const res = await fetch("/api/email/connections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure_connect", provider }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        authorizeUrl?: string;
        status?: string;
        detail?: string;
      } | null;
      if (json?.status === "dry-run") {
        toast({ title: "Public demo only", description: json.detail, variant: "info" });
        return;
      }
      if (!json?.ok || !json.authorizeUrl) {
        toast({
          title: "Cannot start OAuth",
          description: json?.error ?? `Request failed (${res.status}).`,
          variant: "error",
        });
        return;
      }
      window.location.href = json.authorizeUrl;
    } catch {
      toast({ title: "Connect failed", description: "Network error.", variant: "error" });
    } finally {
      setConnecting(null);
    }
  }

  async function testSeat(seatId: string) {
    setTestingSeat(seatId);
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatId }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        status?: string;
        message?: string;
        detail?: string;
        error?: string;
        latencyMs?: number;
        checks?: { id: string; ok: boolean; detail: string }[];
      } | null;
      const failed = json?.checks?.filter((c) => !c.ok) ?? [];
      if (json?.status === "dry-run") {
        toast({
          title: "Public demo only",
          description: json.detail ?? json.message ?? "Mailbox validate is dry-run — nothing checked live.",
          variant: "info",
        });
      } else {
        toast({
          title: json?.ok ? "Mailbox validated" : "Mailbox needs attention",
          description:
            json?.message ??
            json?.error ??
            (failed.length ? failed.map((c) => c.detail).join(" · ") : `HTTP ${res.status}`),
          variant: json?.ok ? "success" : "error",
        });
      }
      await load();
    } catch {
      toast({ title: "Test failed", description: "Network error.", variant: "error" });
    } finally {
      setTestingSeat(null);
    }
  }

  async function registerInbound(seatId: string) {
    try {
      const res = await fetch("/api/email/connections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register_inbound", seatId, purpose: "reply" }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      toast({
        title: json?.ok ? "Inbound route registered" : "Route registration failed",
        description: json?.ok ? "Webhook replies will resolve to this workspace." : json?.error,
        variant: json?.ok ? "success" : "error",
      });
      await load();
    } catch {
      toast({ title: "Route registration failed", description: "Network error.", variant: "error" });
    }
  }

  async function ensureGraphWebhook(connectionId: string) {
    setEnsuringWebhook(connectionId);
    try {
      const res = await fetch("/api/email/connections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure_graph_webhook", connectionId }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        mode?: string;
      } | null;
      toast({
        title: json?.ok ? "Graph webhook enabled" : "Graph webhook failed",
        description: json?.detail ?? json?.error ?? `HTTP ${res.status}`,
        variant: json?.ok ? "success" : "error",
      });
      await load();
    } catch {
      toast({ title: "Graph webhook failed", description: "Network error.", variant: "error" });
    } finally {
      setEnsuringWebhook(null);
    }
  }

  async function disconnect(seatId: string) {
    const res = await actions.disconnectSeatAccount(seatId);
    if (!res.ok) {
      toast({ title: "Disconnect failed", description: res.error, variant: "error" });
      return;
    }
    toast({
      title: res.dryRun ? "Public demo only" : "Mailbox disconnected",
      description: res.dryRun ? res.error : undefined,
      variant: res.dryRun ? "info" : "info",
    });
    await load();
  }

  const providers = data?.providers;
  const connections = data?.connections ?? [];

  return (
    <Card id={EMAIL_CONNECTIONS_PANEL_ID} className="overflow-hidden border-line/80 bg-surface shadow-sm">
      <CardContent className="space-y-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <Eyebrow>Mailbox</Eyebrow>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink">Connect email</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Link Gmail or Outlook with OAuth. Outlook hiring needs arrive via Microsoft Graph webhook
              push — no inbox polling. Use Enable webhook after connect if push was not created automatically.
            </p>
          </div>
          <Badge tone={connections.length ? "success" : "neutral"} size="sm" dot>
            {connections.length ? `${connections.length} connected` : "Not connected"}
          </Badge>
        </div>

        {providers ? <SystemReadiness items={ReadinessFromProviders(providers)} /> : null}

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                leftIcon={<Mail className="h-4 w-4" />}
                loading={connecting === "Gmail API"}
                disabled={!providers?.gmailOAuth || !providers.encryptionReady}
                onClick={() => void connect("Gmail API")}
              >
                Connect Gmail
              </Button>
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Plug className="h-4 w-4" />}
                loading={connecting === "Microsoft Graph"}
                disabled={!providers?.microsoftOAuth || !providers.encryptionReady}
                onClick={() => void connect("Microsoft Graph")}
              >
                Connect Outlook
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
                Refresh status
              </Button>
            </div>
            {providers && (!providers.microsoftOAuth || !providers.encryptionReady) ? (
              <p className="max-w-md text-xs text-muted">
                {!providers.encryptionReady
                  ? "Token encryption missing (DATA_ENCRYPTION_KEY) — Connect Outlook stays disabled."
                  : "Microsoft Graph OAuth env missing (MICROSOFT_CLIENT_ID / SECRET / REDIRECT_URI) — Connect Outlook stays disabled."}
              </p>
            ) : null}
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted">Ask a workspace admin to connect a mailbox.</p>
        )}

        {loading ? (
          <p className="text-xs text-muted">Loading connections…</p>
        ) : data?.demo ? (
          <p className="text-xs text-muted">{data.detail ?? "Demo mode — no live mailboxes."}</p>
        ) : data?.error && !data.ok ? (
          <div className="flex items-start gap-2 rounded-2xl bg-danger-soft px-3 py-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {data.error}
          </div>
        ) : connections.length === 0 ? (
          <p className="text-xs text-muted">
            {providers && !providers.microsoftOAuth && !providers.gmailOAuth
              ? "No mailbox linked — OAuth credentials are not configured on this deployment, so connect buttons stay disabled."
              : "No mailbox linked yet. Connect Gmail or Outlook above — Aria creates a fleet seat if needed."}
          </p>
        ) : (
          <ul className="space-y-2">
            {connections.map((c, i) => {
              const routeOk = Boolean(c.inboundRoute?.active);
              const graphOk = c.provider !== "Microsoft Graph" || Boolean(c.graphSubscription?.active);
              const healthy = c.hasRefreshToken && routeOk && graphOk;
              const graphMeta =
                c.provider === "Microsoft Graph"
                  ? c.graphSubscription?.active
                    ? ` · webhook until ${new Date(c.graphSubscription.expiresAt).toLocaleDateString()}`
                    : " · Graph webhook missing"
                  : "";
              return (
                <motion.li
                  key={c.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <ConnectionListItem
                    title={c.accountEmail}
                    meta={`Seat ${c.seatName ?? c.seatId.slice(0, 8)} · ${c.hasRefreshToken ? "refresh token OK" : "missing refresh token"} · ${routeOk ? `inbound ${c.inboundRoute?.purpose}` : "inbound route missing"}${graphMeta}`}
                    healthy={healthy}
                    badges={
                      <>
                        <Badge tone="neutral" size="sm">
                          {c.provider}
                        </Badge>
                        {c.provider === "Microsoft Graph" && (
                          <Badge tone={c.graphSubscription?.active ? "success" : "warning"} size="sm">
                            {c.graphSubscription?.active ? "Webhook active" : "Webhook off"}
                          </Badge>
                        )}
                      </>
                    }
                    actions={
                      <>
                        <Button
                          size="sm"
                          variant="subtle"
                          leftIcon={<Activity className="h-3.5 w-3.5" />}
                          loading={testingSeat === c.seatId}
                          onClick={() => void testSeat(c.seatId)}
                        >
                          Validate
                        </Button>
                        {isAdmin
                          && c.provider === "Microsoft Graph"
                          && (!c.graphSubscription?.active || c.seatMode !== "live") && (
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<Link2 className="h-3.5 w-3.5" />}
                            loading={ensuringWebhook === c.id}
                            onClick={() => void ensureGraphWebhook(c.id)}
                          >
                            {c.graphSubscription?.active && c.seatMode !== "live"
                              ? "Repair live seat"
                              : "Enable webhook"}
                          </Button>
                        )}
                        {isAdmin && !routeOk && (
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<Link2 className="h-3.5 w-3.5" />}
                            onClick={() => void registerInbound(c.seatId)}
                          >
                            Register inbound
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Unplug className="h-3.5 w-3.5" />}
                            onClick={() => void disconnect(c.seatId)}
                          >
                            Disconnect
                          </Button>
                        )}
                      </>
                    }
                  />
                </motion.li>
              );
            })}
          </ul>
        )}

        <p className="flex items-start gap-1.5 text-xs text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          After connect: run Validate, then Enable webhook for Outlook (Graph push). Emergency inbox sync on
          Intake is break-glass only. MCP servers are tested under AI &amp; Models → MCP. See{" "}
          <code className="rounded bg-ink/[0.06] px-1 font-mono">docs/runbooks/connect-gmail-outlook.md</code>.
        </p>
      </CardContent>
    </Card>
  );
}
