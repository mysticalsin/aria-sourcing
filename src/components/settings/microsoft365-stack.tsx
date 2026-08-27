"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  azureLoginEnabled,
  supabaseEnabled,
} from "@/lib/supabase/config";
import { EMAIL_CONNECTIONS_PANEL_ID } from "@/components/settings/email-connections-panel";
import {
  ConnectionStackShell,
  ConnectionStep,
  SystemReadiness,
} from "@/components/settings/integration-connection-primitives";

export const MICROSOFT365_STACK_ID = "microsoft365-stack";

type ProviderReadiness = {
  microsoftOAuth: boolean;
  encryptionReady: boolean;
  inboundWebhookSecret: boolean;
};

type ConnectionRow = {
  provider: string;
  accountEmail: string;
  hasRefreshToken: boolean;
  scope: string;
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
  providers?: ProviderReadiness;
  connections?: ConnectionRow[];
  error?: string;
};

function hasCalendarScope(scope: string): boolean {
  return /calendars\.readwrite/i.test(scope) || /onlineMeetings\.readwrite/i.test(scope);
}

function Microsoft365StackInner() {
  const [loading, setLoading] = React.useState(true);
  const [payload, setPayload] = React.useState<ConnectionsPayload | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/email/connections", {
          method: "GET",
          credentials: "include",
        });
        const json = (await res.json().catch(() => null)) as ConnectionsPayload | null;
        if (!cancelled) setPayload(json);
      } catch {
        if (!cancelled) setPayload({ ok: false, error: "Network error loading Microsoft 365 status." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const providers = payload?.providers;
  const outlookConnections = (payload?.connections ?? []).filter(
    (c) => c.provider === "Microsoft Graph" && c.accountEmail.trim(),
  );
  const connectedOutlook = outlookConnections.find((c) => c.hasRefreshToken) ?? null;
  const inboundActive = Boolean(connectedOutlook?.inboundRoute?.active);
  const graphSubscriptionActive = Boolean(connectedOutlook?.graphSubscription?.active);
  const calendarScoped = Boolean(connectedOutlook && hasCalendarScope(connectedOutlook.scope));

  // Public flag only — not live Entra proof. Never mark SSO "complete" from the flag alone.
  const ssoFlagOn = azureLoginEnabled;
  const oauthReady = Boolean(providers?.microsoftOAuth && providers.encryptionReady);
  const mailboxConnected = Boolean(connectedOutlook);
  const inboundReady = Boolean(providers?.inboundWebhookSecret);
  const calendarReady = mailboxConnected && calendarScoped;
  // Step 4 is webhook push readiness: durable mailbox route AND live Graph subscription.
  const webhookIntakeReady = inboundActive && graphSubscriptionActive;

  // Ready gate = live mailbox loop surfaces only (Outlook + calendar + Graph webhook).
  // Entra SSO flag is informational — GoTrue Azure is not probed here.
  const stepsComplete =
    (oauthReady && mailboxConnected ? 1 : 0) +
    (calendarReady ? 1 : 0) +
    (webhookIntakeReady ? 1 : 0);
  const progressPct = (stepsComplete / 3) * 100;

  let statusLabel = loading ? "Checking Microsoft 365…" : "Not started";
  let statusTone: "neutral" | "success" | "electric" = "neutral";
  if (!loading && stepsComplete === 3) {
    statusLabel = "Microsoft 365 ready";
    statusTone = "success";
  } else if (!loading && mailboxConnected && !webhookIntakeReady) {
    statusLabel = graphSubscriptionActive
      ? `Outlook connected — inbound route incomplete`
      : `Outlook connected — Graph webhook inactive`;
    statusTone = "electric";
  } else if (!loading && mailboxConnected) {
    statusLabel = `Outlook connected (${connectedOutlook?.accountEmail})`;
    statusTone = "electric";
  } else if (!loading && oauthReady) {
    statusLabel = "Outlook OAuth configured — connect a mailbox";
    statusTone = "electric";
  } else if (!loading && ssoFlagOn) {
    statusLabel = "SSO flag on — connect Outlook (verify Entra on /login)";
    statusTone = "electric";
  }

  return (
    <ConnectionStackShell
      id={MICROSOFT365_STACK_ID}
      eyebrow="Microsoft 365"
      title="Entra SSO, Outlook & Teams"
      description="Sign in with Microsoft, connect Outlook for mail, calendar, and Teams meeting links. Inbound hiring needs arrive via webhook — no agent polls your inbox."
      statusLabel={statusLabel}
      statusTone={statusTone}
      progressPct={progressPct}
      progressLabel={
        loading
          ? "Loading live status…"
          : `${stepsComplete} of 3 live mailbox steps ready` +
            (ssoFlagOn ? " · SSO flag on (verify on /login)" : "")
      }
      footer={
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Tokens encrypted at rest. Calendar events include Teams links when Graph returns them.
          See{" "}
          <Link href="/docs/runbooks/connect-gmail-outlook.md" className="text-aqua underline-offset-2 hover:underline">
            connect runbook
          </Link>
          .
        </p>
      }
    >
      <ConnectionStep
        step={1}
        title="Entra SSO (sign-in)"
        subtitle="Build-time login flag only — confirm Sign in with Microsoft works on /login (GoTrue Azure)."
        state={ssoFlagOn ? "active" : supabaseEnabled ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "azure-flag",
              label: "Azure login flag (not live-verified)",
              ok: ssoFlagOn,
              hint: ssoFlagOn
                ? "NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true — flag is not Entra proof; try /login."
                : "Set NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true and configure GoTrue Azure provider on Fly.",
            },
            {
              id: "supabase",
              label: "Supabase auth",
              ok: supabaseEnabled,
              hint: supabaseEnabled ? "Live tenant" : "Demo mode — SSO requires Supabase.",
            },
          ]}
        />
      </ConnectionStep>

      <ConnectionStep
        step={2}
        title="Outlook mailbox (send + read)"
        subtitle="OAuth connect — Mail.Send, Mail.Read, encrypted tokens."
        state={mailboxConnected ? "complete" : oauthReady || supabaseEnabled ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "graph-oauth",
              label: "Microsoft Graph OAuth env",
              ok: oauthReady,
              hint: loading
                ? "Checking deployment env…"
                : oauthReady
                  ? "MICROSOFT_CLIENT_ID + secret configured"
                  : "Set MICROSOFT_CLIENT_* and DATA_ENCRYPTION_KEY.",
            },
            {
              id: "connect-outlook",
              label: "Connect Outlook mailbox",
              ok: mailboxConnected,
              hint: mailboxConnected
                ? `Connected as ${connectedOutlook?.accountEmail}`
                : `Use Connect Outlook in #${EMAIL_CONNECTIONS_PANEL_ID} below.`,
            },
          ]}
        />
      </ConnectionStep>

      <ConnectionStep
        step={3}
        title="Calendar & Teams interviews"
        subtitle="First conversations booked on Outlook with Teams join links."
        state={calendarReady ? "complete" : mailboxConnected ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "calendar-scope",
              label: "Calendars.ReadWrite scope",
              ok: calendarScoped,
              hint: calendarScoped
                ? "Granted on connected Outlook mailbox"
                : mailboxConnected
                  ? "Reconnect Outlook if calendar scope is missing from the token."
                  : "Connect Outlook — calendar scope is requested at authorize time.",
            },
            {
              id: "teams-links",
              label: "Teams meeting links",
              ok: calendarReady,
              hint: "Graph events created with isOnlineMeeting when booking interviews.",
            },
          ]}
        />
      </ConnectionStep>

      <ConnectionStep
        step={4}
        title="Webhook intake (no polling)"
        subtitle="Microsoft Graph pushes Inbox creates to Aria — agents never idle-scan mailboxes."
        state={graphSubscriptionActive ? "complete" : mailboxConnected || inboundReady ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "graph-webhook",
              label: "Graph mail subscription",
              ok: graphSubscriptionActive,
              hint: graphSubscriptionActive
                ? `Active until ${connectedOutlook?.graphSubscription?.expiresAt ?? "unknown"} (auto-renewed by loop worker)`
                : mailboxConnected
                  ? "Outlook connected but no active Graph subscription — use Enable webhook under Connect email."
                  : "Connect Outlook to register a Graph change-notification subscription.",
            },
            {
              id: "webhook-secret",
              label: "HMAC adapter secret (optional)",
              ok: inboundReady,
              hint: loading
                ? "Checking deployment env…"
                : inboundReady
                  ? "Also accepts signed POST /api/webhooks/email-inbound"
                  : "Optional for n8n/adapters; Graph path uses clientState.",
            },
            {
              id: "need-routing",
              label: "Hiring-need routing",
              ok: mailboxConnected ? inboundActive : inboundReady,
              hint: inboundActive
                ? `Inbound route active for ${connectedOutlook?.inboundRoute?.mailbox}`
                : "Need emails → requisition_parse; replies → inbound_classify.",
            },
            {
              id: "entra-sso",
              label: "Entra SSO flag (verify on /login)",
              ok: ssoFlagOn,
              hint: ssoFlagOn
                ? "Flag on — not counted as M365-ready; confirm Microsoft sign-in on /login."
                : "Off until GoTrue Azure env is configured; fly-deploy-now.sh enables NEXT_PUBLIC_ENABLE_AZURE_LOGIN when secrets are complete.",
            },
          ]}
        />
      </ConnectionStep>
    </ConnectionStackShell>
  );
}

export function Microsoft365Stack() {
  return <Microsoft365StackInner />;
}
