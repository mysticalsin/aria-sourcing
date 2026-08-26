"use client";

import { ShieldCheck, Building2 } from "lucide-react";
import Link from "next/link";
import {
  azureLoginEnabled,
  supabaseEnabled,
} from "@/lib/supabase/config";
import { emailProviderReadiness } from "@/lib/email-connections";
import { EMAIL_CONNECTIONS_PANEL_ID } from "@/components/settings/email-connections-panel";
import {
  ConnectionStackShell,
  ConnectionStep,
  SystemReadiness,
} from "@/components/settings/integration-connection-primitives";

export const MICROSOFT365_STACK_ID = "microsoft365-stack";

function Microsoft365StackInner() {
  const readiness = emailProviderReadiness();
  const ssoReady = azureLoginEnabled;
  const oauthReady = readiness.microsoftOAuth && readiness.encryptionReady;
  const inboundReady = readiness.inboundWebhookSecret;
  const calendarReady = oauthReady;

  const stepsComplete =
    (ssoReady ? 1 : 0) +
    (oauthReady ? 1 : 0) +
    (inboundReady ? 1 : 0) +
    (calendarReady ? 1 : 0);
  const progressPct = (stepsComplete / 4) * 100;

  let statusLabel = "Not started";
  let statusTone: "neutral" | "success" | "electric" = "neutral";
  if (stepsComplete === 4) {
    statusLabel = "Microsoft 365 ready";
    statusTone = "success";
  } else if (oauthReady) {
    statusLabel = "Outlook configured — finish SSO & webhook";
    statusTone = "electric";
  } else if (ssoReady) {
    statusLabel = "SSO enabled — connect Outlook";
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
      progressLabel={`${stepsComplete} of 4 steps ready`}
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
        subtitle="Workspace login via Microsoft — required for enterprise tenants."
        state={ssoReady ? "complete" : supabaseEnabled ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "azure-flag",
              label: "Azure login flag",
              ok: ssoReady,
              hint: ssoReady
                ? "NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true"
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
        state={oauthReady ? "complete" : ssoReady || supabaseEnabled ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "graph-oauth",
              label: "Microsoft Graph OAuth env",
              ok: oauthReady,
              hint: oauthReady
                ? "MICROSOFT_CLIENT_ID + secret configured"
                : "Set MICROSOFT_CLIENT_* and DATA_ENCRYPTION_KEY.",
            },
            {
              id: "connect-outlook",
              label: "Connect Outlook mailbox",
              ok: false,
              hint: `Use Connect Outlook in #${EMAIL_CONNECTIONS_PANEL_ID} below.`,
            },
          ]}
        />
      </ConnectionStep>

      <ConnectionStep
        step={3}
        title="Calendar & Teams interviews"
        subtitle="First conversations booked on Outlook with Teams join links."
        state={calendarReady ? "complete" : oauthReady ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "calendar-scope",
              label: "Calendars.ReadWrite scope",
              ok: oauthReady,
              hint: oauthReady
                ? "Granted on Outlook OAuth connect"
                : "Connect Outlook — calendar scope is requested at authorize time.",
            },
            {
              id: "teams-links",
              label: "Teams meeting links",
              ok: oauthReady,
              hint: "Graph events created with isOnlineMeeting when booking interviews.",
            },
          ]}
        />
      </ConnectionStep>

      <ConnectionStep
        step={4}
        title="Webhook intake (no polling)"
        subtitle="Graph adapter or n8n forwards mail — agents never idle-scan inboxes."
        state={inboundReady ? "complete" : oauthReady ? "active" : "pending"}
      >
        <SystemReadiness
          items={[
            {
              id: "webhook-secret",
              label: "EMAIL_INBOUND_WEBHOOK_SECRET",
              ok: inboundReady,
              hint: inboundReady
                ? "HMAC secret configured"
                : "Set secret; POST /api/webhooks/email-inbound with x-aria-signature",
            },
            {
              id: "need-routing",
              label: "Hiring-need routing",
              ok: inboundReady,
              hint: "Need emails → requisition_parse; replies → inbound_classify.",
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
