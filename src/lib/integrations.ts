import type { IntegrationStatus } from "./types";
import { isoHoursBefore } from "./utils";
import { supabaseEnabled } from "./supabase/config";

/* ============================================================================
   Integration adapters — MOCK MODE by default.
   Most of these cards are roadmap placeholders (`real: false`): no code in this
   repo talks to them. A few (`real: true`) do have actual backend wiring —
   GitHub Sourcing (/api/source), Apify LinkedIn profile search (/api/source/apify),
   the Outlook/Graph mailbox + calendar (Agent Fleet's OAuth connect flow), and
   SendGrid/Resend (sendViaProvider) — but this card's own "Configure"/"Live
   mode" controls still don't drive them; see setupHref and testIntegration
   (store.ts) for the real config surface.
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
      real: true,
      setupHref: "/fleet",
    },
    {
      id: "int_resume_matcher",
      name: "Resume Matcher API",
      category: "Enrichment",
      description: "Structured CV ↔ JD scoring service for composite match breakdowns.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
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
      real: true,
    },
    {
      id: "int_apify",
      name: "Apify (LinkedIn profile search)",
      category: "Sourcing",
      description:
        "LinkedIn public-profile data via a compliant third-party provider (Apify harvestapi); no direct LinkedIn login, scraping, or session automation. Add the key in Access & Keys.",
      status: "connected",
      mode: "mock",
      lastSync: isoHoursBefore(0.6),
      errors: [],
      real: true,
      setupHref: "/settings",
    },
    {
      id: "int_linkedin",
      name: "LinkedIn Sourcing",
      category: "Sourcing",
      description:
        "Official LinkedIn partner search is not wired. This card does not accept a pasted API key. Fleet OAuth is identity and messaging only — not partner search. Source people with a valid Apify key in Access & Keys.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [
        "Partner search is not available. Use Access & Keys → Apify for the live harvest that is wired.",
      ],
      real: false,
      setupHref: "/settings",
    },
    {
      id: "int_linkedin_rsc",
      name: "LinkedIn Recruiter System Connect",
      category: "Sourcing",
      description:
        "Official LinkedIn partner search is not wired. Fleet OAuth connects identity and messaging only — not partner search. This card does not accept a pasted API key. Source via Apify when that key is valid.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [
        "Official partner search is not available. Source people with a valid Apify key in Access & Keys.",
      ],
      real: false,
      setupHref: "/settings",
    },
    {
      id: "int_heyreach",
      name: "HeyReach",
      category: "Comms",
      description:
        "LinkedIn send account for drafted campaigns. Connect the API or MCP key in Access & Keys. Send stays dry-run until you approve.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: true,
      setupHref: "/settings",
    },
    {
      id: "int_twenty",
      name: "Twenty CRM",
      category: "CRM",
      description: "Sync candidates, activities, and outcomes to the CRM of record.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
    },
    {
      id: "int_smart_ats",
      name: "SMART (ATS)",
      category: "CRM",
      description: "Bidirectional ATS of record: needs, lead + candidate records (all sources), Cvtheque, pipeline, offer tracking, hire registration, source-of-hire capture.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
    },
    {
      id: "int_knight_m",
      name: "Knight M",
      category: "Enrichment",
      description: "Job-ad compliance check, re-run on every edit before publish (inclusive language, pay transparency, accessibility).",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
    },
    {
      id: "int_my_referral",
      name: "My Referral app",
      category: "Sourcing",
      description: "Employee referral submissions → Referral Evaluator trigger, referrer notification, and source traceability.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
    },
    {
      id: "int_onestart",
      name: "OneStart / HR onboarding",
      category: "Infra",
      description: "Hire declaration, pre-boarding checklist, candidate → employee portal, and Time-to-Proficiency tracking. Target system to be scoped with HR.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: ["Onboarding target system pending scope with HR (per TAnIA open items)."],
      real: false,
    },
    {
      id: "int_supabase",
      name: "Supabase",
      category: "Infra",
      description: "Postgres + auth backend for production persistence (demo uses localStorage).",
      // The one card in this list that IS the app's actual data layer, not a
      // roadmap placeholder — seed it from the real runtime flag so a freshly
      // provisioned live workspace doesn't start out lying about its own backend.
      status: supabaseEnabled ? "connected" : "not_configured",
      mode: supabaseEnabled ? "live" : "mock",
      lastSync: null,
      errors: supabaseEnabled ? [] : ["No project URL configured: demo runs on localStorage."],
      real: true,
    },
    {
      id: "int_n8n",
      name: "n8n",
      category: "Infra",
      description: "Workflow automation for cross-system orchestration & webhooks.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
    },
    {
      id: "int_calcom",
      name: "Cal.com",
      category: "Calendar",
      description: "Generate scheduling links and capture interview bookings.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
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
      real: true,
      setupHref: "/fleet",
    },
    {
      id: "int_enrichment",
      name: "Apollo / Hunter / Clearbit",
      category: "Enrichment",
      description: "Contact enrichment via official APIs only: no scraping.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
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
      real: true,
    },
    {
      id: "int_notify",
      name: "Slack / Telegram",
      category: "Comms",
      description: "Operator notifications for approvals, hot replies, and SLA breaches.",
      status: "not_configured",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
    },
  ];
}

/** Configuration catalogue for a new live tenant. Seed connection timestamps
 * are demo fixtures, so every adapter starts explicitly unconfigured. Real
 * adapters stay `real: true` so Configure/Test remain visible; they are not
 * labelled Live until credentials exist. */
/** LinkedIn people-search cards. Partner search is not wired — never an API-key paste. */
export function isLinkedInSourcingCard(
  integration: Pick<IntegrationStatus, "id" | "name" | "category">,
): boolean {
  if (integration.id === "int_linkedin" || integration.id === "int_linkedin_rsc") return true;
  if (integration.id.startsWith("int_linkedin")) return true;
  return integration.category === "Sourcing" && /linkedin/i.test(integration.name);
}

function honestLinkedInSourcingCard(
  card: IntegrationStatus,
  seed: IntegrationStatus,
): IntegrationStatus {
  return {
    ...card,
    name: seed.name,
    description: seed.description,
    setupHref: "/settings",
    real: false,
    status: "not_configured",
    mode: "mock",
    lastSync: null,
    errors: seed.errors,
    connectedAccount: undefined,
  };
}

export function defaultLiveIntegrations(): IntegrationStatus[] {
  return defaultIntegrations().map((integration) => ({
    ...integration,
    status: "not_configured",
    mode: "mock",
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
  if (!integration.real) {
    return {
      ok: false,
      latencyMs: 0,
      message: `${integration.name}: not configured. This card is a roadmap placeholder with no live adapter.`,
    };
  }
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

/** Same shape as integrationHealthSummary, scoped to integrations with actual
 *  backend wiring (`real: true`). Use this anywhere a "connected" count is meant
 *  to reflect real system health (sidebar, dashboard strip) rather than the
 *  full roadmap list of cards. */
export function realIntegrationSummary(integrations: IntegrationStatus[]): ReturnType<typeof integrationHealthSummary> {
  return integrationHealthSummary(integrations.filter((i) => i.real));
}

/** Keep stored workspace cards aligned with the seed catalogue so a live
 *  tenant cannot lose Apify (or any later real card). Extra stored cards stay. */
export function mergeSeedIntegrations(stored: IntegrationStatus[]): IntegrationStatus[] {
  const seed = defaultIntegrations();
  const byId = new Map(stored.map((row) => [row.id, row]));
  const merged = seed.map((card) => {
    const existing = byId.get(card.id);
    if (!existing) {
      return {
        ...card,
        status: card.id === "int_supabase" ? card.status : "not_configured",
        mode: card.id === "int_supabase" ? card.mode : "mock",
        lastSync: card.id === "int_supabase" ? card.lastSync : null,
      };
    }
    if (isLinkedInSourcingCard(card)) {
      return honestLinkedInSourcingCard(existing, card);
    }
    if (card.id === "int_heyreach") {
      return {
        ...existing,
        name: card.name,
        description: card.description,
        setupHref: card.setupHref,
        real: true,
        status: "not_configured",
        mode: "mock",
        lastSync: null,
      };
    }
    if (!card.real) {
      return {
        ...existing,
        name: card.name,
        description: card.description,
        setupHref: card.setupHref,
        real: false,
        status: "not_configured" as const,
        lastSync: null,
      };
    }
    return {
      ...existing,
      name: card.name,
      description: card.description,
      setupHref: card.setupHref,
      real: true,
    };
  });
  const leftoverLinkedIn = seed.find((card) => card.id === "int_linkedin") ?? seed.find(isLinkedInSourcingCard);
  for (const extra of stored) {
    if (seed.some((card) => card.id === extra.id)) continue;
    if (leftoverLinkedIn && isLinkedInSourcingCard(extra)) {
      merged.push(honestLinkedInSourcingCard(extra, leftoverLinkedIn));
      continue;
    }
    merged.push(extra);
  }
  return merged;
}
