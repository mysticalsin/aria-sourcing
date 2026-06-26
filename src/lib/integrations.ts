import type { IntegrationStatus } from "./types";
import { isoHoursBefore } from "./utils";

/* ============================================================================
   Integration adapters — MOCK MODE by default.
   No real network calls are made anywhere. `live` mode is a placeholder that
   would require official API credentials to be wired in later.
   ========================================================================== */

export function defaultIntegrations(): IntegrationStatus[] {
  return [
    {
      id: "int_outlook",
      name: "Email Inbox / Outlook",
      category: "Inbox",
      description: "Ingest inbound job requests and replies via Microsoft Graph mail.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(0.4),
      errors: [],
    },
    {
      id: "int_resume_matcher",
      name: "Resume Matcher API",
      category: "Enrichment",
      description: "Structured CV ↔ JD scoring service for composite match breakdowns.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(1.2),
      errors: [],
    },
    {
      id: "int_github",
      name: "GitHub Sourcing",
      category: "Sourcing",
      description: "Search public profiles & repositories within platform rate limits.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(0.8),
      errors: [],
    },
    {
      id: "int_linkedin",
      name: "LinkedIn Sourcing",
      category: "Sourcing",
      description: "Official partner search. Never bypasses login walls or scraping limits.",
      status: "degraded",
      mode: "mock",
      lastSync: isoHoursBefore(6),
      errors: ["Awaiting official partner API credentials."],
    },
    {
      id: "int_twenty",
      name: "Twenty CRM",
      category: "CRM",
      description: "Sync candidates, activities, and outcomes to the CRM of record.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(0.6),
      errors: [],
    },
    {
      id: "int_supabase",
      name: "Supabase",
      category: "Infra",
      description: "Postgres + auth backend for production persistence (demo uses localStorage).",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: ["No project URL configured — demo runs on localStorage."],
    },
    {
      id: "int_n8n",
      name: "n8n",
      category: "Infra",
      description: "Workflow automation for cross-system orchestration & webhooks.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(2),
      errors: [],
    },
    {
      id: "int_calcom",
      name: "Cal.com",
      category: "Calendar",
      description: "Generate scheduling links and capture interview bookings.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(0.3),
      errors: [],
    },
    {
      id: "int_graph_teams",
      name: "Microsoft Graph / Teams",
      category: "Calendar",
      description: "Create calendar events and Teams meeting links for interviews.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(0.5),
      errors: [],
    },
    {
      id: "int_enrichment",
      name: "Apollo / Hunter / Clearbit",
      category: "Enrichment",
      description: "Contact enrichment via official APIs only — no scraping.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(3),
      errors: [],
    },
    {
      id: "int_sendgrid",
      name: "SendGrid / Resend",
      category: "Comms",
      description: "Transactional email delivery. Dry-run by default — nothing is sent.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(1),
      errors: [],
    },
    {
      id: "int_notify",
      name: "Slack / Telegram",
      category: "Comms",
      description: "Operator notifications for approvals, hot replies, and SLA breaches.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(0.2),
      errors: [],
    },
  ];
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

/** Deterministic mock connection test. Never touches the network. */
export function testConnection(integration: IntegrationStatus): ConnectionTestResult {
  const seed = integration.id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const latencyMs = 40 + (seed % 180);
  if (integration.status === "not_configured") {
    return {
      ok: false,
      latencyMs,
      message: `${integration.name}: not configured — add credentials to enable.`,
    };
  }
  if (integration.status === "error") {
    return { ok: false, latencyMs, message: `${integration.name}: connection error.` };
  }
  const modeLabel = integration.mode === "mock" ? "mock adapter" : "live API";
  return {
    ok: true,
    latencyMs,
    message: `${integration.name}: ${modeLabel} responded in ${latencyMs}ms.`,
  };
}

export function integrationHealthSummary(integrations: IntegrationStatus[]): {
  connected: number;
  degraded: number;
  error: number;
  notConfigured: number;
  total: number;
} {
  return {
    connected: integrations.filter((i) => i.status === "connected").length,
    degraded: integrations.filter((i) => i.status === "degraded").length,
    error: integrations.filter((i) => i.status === "error").length,
    notConfigured: integrations.filter((i) => i.status === "not_configured").length,
    total: integrations.length,
  };
}
