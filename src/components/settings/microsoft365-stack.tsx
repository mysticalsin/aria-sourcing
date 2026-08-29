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
    subscriptionId?: string;
    status: string;
    expiresAt: string;
    lastNotificationAt: string | null;
    active: boolean;
  } | null;
};

type SeatRow = {
  id: string;
  name?: string;
  provider: string;
  connectedAccount?: string | null;
  mode?: string;
  status?: string;
};

type ConnectionsPayload = {
  ok?: boolean;
  providers?: ProviderReadiness;
  connections?: ConnectionRow[];
  seats?: SeatRow[];
  error?: string;
};

function hasCalendarScope(scope: string): boolean {
  // Authorize requests Calendars.ReadWrite (+ OnlineMeetings.ReadWrite for Teams joinUrl).
  return /calendars\.readwrite/i.test(scope);
}

function hasOnlineMeetingsScope(scope: string): boolean {
  return /onlinemeetings\.readwrite/i.test(scope);
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
  const onlineMeetingsScoped = Boolean(
    connectedOutlook && hasOnlineMeetingsScope(connectedOutlook.scope),
  );

  // Public flag only — not live Entra proof. Never mark SSO "complete" from the flag alone.
  const ssoFlagOn = azureLoginEnabled;
  const oauthReady = Boolean(providers?.microsoftOAuth && providers.encryptionReady);
  const mailboxConnected = Boolean(connectedOutlook);
  const inboundReady = Boolean(providers?.inboundWebhookSecret);
  const liveGraphSeat = (payload?.seats ?? []).some(
    (s) =>
      s.provider === "Microsoft Graph" &&
      s.mode === "live" &&
      (s.status === "active" || !s.status) &&
      Boolean(s.connectedAccount?.trim()),
  );
  // Calendar bookability requires a live seat (confirmLive dry-runs when mode !== live).
  const calendarReady = mailboxConnected && calendarScoped && onlineMeetingsScoped && liveGraphSeat;
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
  } else if (!loading) {
    // Fail closed: never imply Connect Outlook works without Graph client secrets.
    statusLabel = ssoFlagOn
      ? "Outlook OAuth not configured (SSO flag on — verify /login separately)"
      : "Outlook OAuth not configured — register Entra app + set MICROSOFT_CLIENT_* on Fly";
    statusTone = "neutral";
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
        state={ssoFlagOn ? "active" : "pending"}
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
        state={
          mailboxConnected
            ? "complete"
            : !oauthReady && supabaseEnabled
              ? "blocked"
              : oauthReady
                ? "active"
                : "pending"
        }
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
                  ? "MICROSOFT_CLIENT_ID + secret + tenant + REDIRECT_URI configured"
                  : "Register single-tenant Entra app (ARIA Mantu Graph), set MICROSOFT_CLIENT_ID / SECRET / TENANT_ID + DATA_ENCRYPTION_KEY on Fly. Tenant may block user app create (allowedToCreateApps=false) — an admin must register or grant Application Developer.",
            },
            {
              id: "connect-outlook",
              label: "Connect Outlook mailbox",
              ok: mailboxConnected,
              hint: mailboxConnected
                ? `Connected as ${connectedOutlook?.accountEmail}`
                : oauthReady
                  ? `Use Connect Outlook in #${EMAIL_CONNECTIONS_PANEL_ID} below.`
                  : "Connect Outlook stays disabled until Graph OAuth env is complete.",
            },
          ]}
        />
      </ConnectionStep>

      <ConnectionStep
        step={3}
        title="Calendar & Teams interviews"
        subtitle="First conversations proposed on Outlook with Teams join links after confirmLive. JoinUrl is proven only on live /api/calendar/event with confirmLive — never from OAuth scope alone."
        state={calendarReady ? "complete" : mailboxConnected ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "calendar-scope",
              label: "Calendars.ReadWrite + OnlineMeetings.ReadWrite",
              ok: calendarScoped && onlineMeetingsScoped,
              hint:
                calendarScoped && onlineMeetingsScoped
                  ? "Granted on connected Outlook mailbox — confirmLive books request isOnlineMeeting + Teams joinUrl."
                  : mailboxConnected
                    ? "Reconnect Outlook so authorize requests Calendars.ReadWrite and OnlineMeetings.ReadWrite."
                    : oauthReady
                      ? "Connect Outlook — both calendar and OnlineMeetings scopes are requested at authorize time."
                      : "Requires Graph OAuth env, then Connect Outlook.",
            },
            {
              id: "live-graph-seat",
              label: "Live Graph seat (mode=live)",
              ok: liveGraphSeat,
              hint: liveGraphSeat
                ? "Outlook seat is live — confirmLive can create real Teams meetings."
                : mailboxConnected
                  ? "Mailbox connected but seat is still mock — reconnect Outlook after tip deploy so OAuth callback promotes mode=live."
                  : oauthReady
                    ? "Connect Outlook — OAuth callback sets seat mode=live."
                    : "Requires Graph OAuth env, then Connect Outlook.",
            },
          ]}
        />
      </ConnectionStep>

      <ConnectionStep
        step={4}
        title="Webhook intake (no polling)"
        subtitle="Microsoft Graph pushes Inbox creates to Aria — agents never idle-scan mailboxes."
        state={webhookIntakeReady ? "complete" : mailboxConnected || inboundReady ? "active" : "pending"}
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
                  : oauthReady
                    ? "Connect Outlook to register a Graph change-notification subscription."
                    : "Requires Graph OAuth env before webhook subscription can be created.",
            },
            {
              id: "webhook-secret",
              label: "HMAC adapter secret (signed inbound)",
              ok: inboundReady,
              hint: loading
                ? "Checking deployment env…"
                : inboundReady
                  ? "Signed POST /api/webhooks/email-inbound can enqueue hiring needs (non-Graph path)."
                  : "Optional for n8n/adapters; Graph push uses clientState after Outlook connect.",
            },
            {
              id: "need-routing",
              label: "Hiring-need mailbox route (Graph)",
              ok: inboundActive,
              hint: inboundActive
                ? `Inbound route active for ${connectedOutlook?.inboundRoute?.mailbox}`
                : mailboxConnected
                  ? "Mailbox connected but inbound route inactive — reconnect Outlook."
                  : oauthReady
                    ? "Connect Outlook to register Graph routing (need emails → requisition_parse; replies → inbound_classify)."
                    : "Graph mailbox route stays red until Outlook is connected; HMAC path above still enqueues requisition_parse.",
            },
            {
              id: "entra-sso",
              label: "Entra SSO (GoTrue Azure — verify /login)",
              // Public NEXT_PUBLIC flag alone is never live Entra proof.
              ok: false,
              hint: ssoFlagOn
                ? "NEXT_PUBLIC_ENABLE_AZURE_LOGIN is on — still not live-verified here; confirm Sign in with Microsoft on /login after GoTrue Azure secrets."
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
