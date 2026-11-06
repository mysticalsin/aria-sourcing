import type { IntegrationStatus } from "./types";
import { isoHoursBefore } from "./utils";
import { supabaseEnabled } from "./supabase/config";

/* ============================================================================
   Integration adapters — MOCK MODE by default.
   Every card has backend wiring in this repo: GitHub Sourcing (/api/source),
   Apify LinkedIn profile search (/api/source/apify) and enrichment
   (/api/source/enrich), the Outlook/Graph mailbox + calendar (Agent Fleet's
   OAuth connect flow), and SendGrid/Resend (sendViaProvider). This card's own
   "Configure"/"Live mode" controls still don't drive them; see setupHref and
   testIntegration (store.ts) for the real config surface.
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
      setupHref: "/fleet",
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
      id: "int_apify",
      name: "Apify (LinkedIn profile search)",
      category: "Sourcing",
      description:
        "LinkedIn public-profile data via a compliant third-party provider (Apify harvestapi); no direct LinkedIn login, scraping, or session automation.",
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
      // The one card in this list that IS the app's actual data layer — seed it
      // from the real runtime flag so a freshly
      // provisioned live workspace doesn't start out lying about its own backend.
      status: supabaseEnabled ? "connected" : "not_configured",
      mode: supabaseEnabled ? "live" : "mock",
      lastSync: null,
      errors: supabaseEnabled ? [] : ["No project URL configured: demo runs on localStorage."],
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
      setupHref: "/fleet",
    },
    {
      id: "int_enrichment",
      name: "Apify LinkedIn enrichment",
      category: "Enrichment",
      description: "Profile and contact enrichment through the Apify dev_fusion actor (Settings → API keys).",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
    },
    {
      id: "int_sendgrid",
      name: "SendGrid / Resend",
      category: "Comms",
      description: "Transactional email delivery. Dry-run by default (nothing is sent).",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(1),
      errors: [],
    },
  ];
}

/** Configuration catalogue for a new live tenant. Seed connection timestamps
 * are demo fixtures, so every adapter starts explicitly unconfigured. Adapters
 * remain labelled live to expose their actual setup surfaces. */
export function defaultLiveIntegrations(): IntegrationStatus[] {
  return defaultIntegrations().map((integration) => ({
    ...integration,
    status: "not_configured",
    mode: "live",
    lastSync: null,
    connectedAccount: undefined,
  }));
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

/**
 * Honest connection check. Mock adapters make no network call (and say so); live
 * credentials are validated server-side on the next real sync, not faked here.
 */
export function testConnection(integration: IntegrationStatus): ConnectionTestResult {
  if (integration.status === "not_configured") {
    return {
      ok: false,
      latencyMs: 0,
      message: `${integration.name}: not configured. Add credentials to enable.`,
    };
  }
  if (integration.status === "error") {
    return { ok: false, latencyMs: 0, message: `${integration.name}: last sync failed. Re-check credentials.` };
  }
  if (integration.mode === "mock") {
    return {
      ok: true,
      latencyMs: 0,
      message: `${integration.name}: mock adapter. Sample data only, no live call. Switch to Live to validate real credentials.`,
    };
  }
  return {
    ok: true,
    latencyMs: 0,
    message: `${integration.name}: live credentials stored, and will be validated on the next sync.`,
  };
}

/** What one integration card is, in a single word. A mock-mode integration
 *  answers with simulated data, so "connected" there means "Simulated", never
 *  "Connected". */
export function integrationStateLabel(integration: IntegrationStatus): string {
  if (integration.status === "connected") return integration.mode === "live" ? "Live" : "Simulated";
  if (integration.status === "degraded") return "Degraded";
  if (integration.status === "error") return "Error";
  return "Not configured";
}

/** The one integration count every screen shows (sidebar, home strip,
 *  Settings): live connections apart from simulated ones. */
export function integrationCounts(integrations: IntegrationStatus[]): {
  live: number;
  simulated: number;
  degraded: number;
  error: number;
  notConfigured: number;
  total: number;
} {
  const state = (label: string) => integrations.filter((i) => integrationStateLabel(i) === label).length;
  return {
    live: state("Live"),
    simulated: state("Simulated"),
    degraded: state("Degraded"),
    error: state("Error"),
    notConfigured: state("Not configured"),
    total: integrations.length,
  };
}
