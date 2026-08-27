import { defaultIntegrations } from "../integrations";
import { buildSeedState, defaultSettings, seedInterviewers, STATE_VERSION } from "../seed";
import { DEFAULT_STAR_THRESHOLDS, deriveLeadSource, deriveStarRating } from "../tania";
import type { HermesState } from "../types";
import { demoStateAllowsCandidatePersistence } from "./demo-persistence";

const STORAGE_KEY = "hermes-sourcing:v1";

function withoutLegacyIntegrationAuthority(settings: HermesState["settings"]): HermesState["settings"] {
  const cleaned = { ...settings } as HermesState["settings"] & { databricks?: unknown; dust?: unknown };
  delete cleaned.databricks;
  delete cleaned.dust;
  return cleaned;
}

/** Fill in any fields added in recent STATE_VERSIONs without wiping existing data. */
export function migrateToCurrentVersion(parsed: HermesState): HermesState {
  const defs = defaultSettings();
  // STATE_VERSION 12 — the demo moved to Kimi (Kimi Code) via the server env key.
  // Blobs older than 12 have their model layer reset below so returning visitors
  // leave the previous Anthropic default (which would fall back to the mock).
  const preKimi = (parsed.version ?? 0) < 12;
  // STATE_VERSION 18 — wipe fake "connected" seeds on real cards (GitHub/Apify/Graph/SendGrid)
  // that never had a real credential attached.
  const preHonestIntegrations = (parsed.version ?? 0) < 18;
  const preCleanSlate = (parsed.version ?? 0) < 19;
  const starT = parsed.settings?.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;
  const FAKE_CONNECTED_IDS = new Set(["int_github", "int_apify", "int_graph_teams", "int_sendgrid"]);
  const clean = preCleanSlate ? buildSeedState() : null;
  return {
    ...(clean ?? parsed),
    version: STATE_VERSION,
    campaigns: preCleanSlate ? clean!.campaigns : (parsed.campaigns ?? []),
    candidates: preCleanSlate
      ? []
      : (parsed.candidates ?? []).map((c) => ({
          ...c,
          leadSource: c.leadSource ?? deriveLeadSource(c),
          starRating: c.starRating ?? deriveStarRating(c.matchScore, starT),
        })),
    chatboxSubmissions: preCleanSlate ? [] : (parsed.chatboxSubmissions ?? []),
    outreach: preCleanSlate ? [] : (parsed.outreach ?? []),
    replies: preCleanSlate ? [] : (parsed.replies ?? []),
    bookings: preCleanSlate ? [] : (parsed.bookings ?? []),
    wins: preCleanSlate ? [] : (parsed.wins ?? []),
    reports: preCleanSlate ? [] : (parsed.reports ?? []),
    activities: preCleanSlate ? clean!.activities : (parsed.activities ?? []),
    ledger: preCleanSlate ? [] : (parsed.ledger ?? []),
    ingestedMessageIds: preCleanSlate ? [] : (parsed.ingestedMessageIds ?? []),
    activeCampaignId: preCleanSlate ? clean!.activeCampaignId : (parsed.activeCampaignId ?? null),
    // STATE_VERSION 16 — re-sync each stored integration's `real` flag against
    // the current seed. Roadmap placeholders (`real: false`) also lose any older
    // fabricated connected/lastSync state; real cards keep their usage history.
    // STATE_VERSION 18 — also reset known fake-connected real cards.
    integrations:
      parsed.integrations && parsed.integrations.length > 0
        ? parsed.integrations.map((i) => {
            const seed = defaultIntegrations().find((d) => d.id === i.id);
            if (!seed) return i;
            if (!seed.real) {
              return { ...i, real: false, status: "not_configured" as const, lastSync: null };
            }
            if (preHonestIntegrations && FAKE_CONNECTED_IDS.has(i.id) && i.mode === "mock") {
              return {
                ...i,
                real: true,
                status: seed.status,
                mode: seed.mode,
                lastSync: seed.lastSync,
                errors: seed.errors,
              };
            }
            return { ...i, real: true };
          })
        : defaultIntegrations(),
    apiKeys: parsed.apiKeys ?? [],
    currentRole: parsed.currentRole ?? "admin",
    skills: parsed.skills ?? [],
    suppression: parsed.suppression ?? [],
    // Inbound-email dedup ledger — initialise on upgrade so re-sync after an
    // upgrade can't double-create replies for already-ingested messages.
    // STATE_VERSION 9 — per-agent chat threads.
    chats: parsed.chats ?? [],
    // STATE_VERSION 10 — per-agent memory.
    memory: parsed.memory ?? [],
    // STATE_VERSION 11 — schedules.
    schedules: parsed.schedules ?? [],
    // STATE_VERSION 14 — registered interviewer roster, replacing the hardcoded
    // mock-ai INTERVIEWERS list. Falls back to that same seed roster (not an
    // empty array) so a returning visitor's existing bookings keep matching a
    // real name in the round-robin instead of silently losing their interviewers.
    interviewers: parsed.interviewers ?? seedInterviewers(),
    settings: {
      ...withoutLegacyIntegrationAuthority(parsed.settings),
      llmProviders: preKimi ? defs.llmProviders : (parsed.settings.llmProviders ?? defs.llmProviders),
      savedModels: preKimi ? defs.savedModels : (parsed.settings.savedModels ?? defs.savedModels),
      tools: parsed.settings.tools ?? defs.tools,
      mcpServers: parsed.settings.mcpServers ?? defs.mcpServers,
      webResearch: parsed.settings.webResearch ?? defs.webResearch,
      defaultModels: preKimi ? defs.defaultModels : (parsed.settings.defaultModels ?? defs.defaultModels),
      // STATE_VERSION 8 — live Aria runtime config.
      hermesLiveMode: parsed.settings.hermesLiveMode ?? defs.hermesLiveMode,
      hermesApiUrl: parsed.settings.hermesApiUrl ?? defs.hermesApiUrl,
      hermesApiKeyId: parsed.settings.hermesApiKeyId ?? defs.hermesApiKeyId,
      // D-2: guardrails and notifications fills.
      guardrails: parsed.settings.guardrails ?? defs.guardrails,
      notifications: parsed.settings.notifications ?? defs.notifications,
      // STATE_VERSION 13 — Mantu Star Rating thresholds.
      starRatingThresholds: parsed.settings.starRatingThresholds ?? defs.starRatingThresholds,
      // STATE_VERSION 11 — Aria management API URL.
      hermesWebUrl: parsed.settings.hermesWebUrl ?? defs.hermesWebUrl ?? "",
    },
    seats: (parsed.seats ?? []).map((seat) => ({
      ...seat,
      providerId: seat.providerId,
      modelId: seat.modelId,
      toolIds: seat.toolIds,
    })),
  };
}

export function normalizeHermesState(parsed: HermesState): HermesState {
  if (parsed.version !== STATE_VERSION) return migrateToCurrentVersion(parsed);
  const settings = withoutLegacyIntegrationAuthority(parsed.settings);
  return {
    ...parsed,
    wins: parsed.wins ?? [],
    settings: {
      ...settings,
      // Quality bar: never contact / accept below 80% unless operator raises further.
      minScoreToContact: Math.max(80, Number(settings.minScoreToContact) || 80),
    },
  };
}

export function loadState(): HermesState {
  if (typeof window === "undefined") return buildSeedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HermesState;
      if (parsed && parsed.version === STATE_VERSION) {
        const normalized = normalizeHermesState(parsed);
        if (demoStateAllowsCandidatePersistence(normalized)) return normalized;
        window.localStorage.removeItem(STORAGE_KEY);
        return buildSeedState();
      }
      // Migrate ANY prior version rather than wiping all data — migrateToCurrentVersion
      // defensively defaults every field, so it can handle arbitrarily old blobs. Only
      // missing/corrupt/unparseable JSON or a non-numeric version falls through to reseed.
      if (parsed && typeof parsed.version === "number") {
        const normalized = normalizeHermesState(parsed);
        if (demoStateAllowsCandidatePersistence(normalized)) return normalized;
        window.localStorage.removeItem(STORAGE_KEY);
        return buildSeedState();
      }
    }
  } catch {
    /* corrupt → reseed */
  }
  return buildSeedState();
}
