import { defaultIntegrations, mergeSeedIntegrations } from "../integrations";
import { applyHarvestKeysToIntegrations } from "../sourcing/people-connect";
import { repairGithubQueries } from "../sourcing/github-search-language";
import { repairLinkedinBoolean } from "../sourcing/linkedin-boolean";
import { tokenizeMustHaveSkills } from "../sourcing/vss-need";
import { buildSeedState, defaultSettings, seedInterviewers, STATE_VERSION } from "../seed";
import { DEFAULT_STAR_THRESHOLDS, deriveLeadSource, deriveStarRating } from "../tania";
import type { Campaign, HermesState } from "../types";
import { demoStateAllowsCandidatePersistence } from "./demo-persistence";

function repairCampaignSkillQueries(campaign: Campaign): Campaign {
  if (!campaign?.jobAnalysis || !campaign.sourcingStrategy?.githubQueries) return campaign;
  const jobAnalysis = {
    ...campaign.jobAnalysis,
    requiredSkills: tokenizeMustHaveSkills(campaign.jobAnalysis.requiredSkills),
    niceToHaveSkills: tokenizeMustHaveSkills(campaign.jobAnalysis.niceToHaveSkills),
  };
  return {
    ...campaign,
    jobAnalysis,
    sourcingStrategy: {
      ...campaign.sourcingStrategy,
      githubQueries: repairGithubQueries(jobAnalysis, campaign.sourcingStrategy.githubQueries),
      linkedinBoolean: repairLinkedinBoolean(jobAnalysis, campaign.sourcingStrategy.linkedinBoolean),
    },
  };
}

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
  const starT = parsed.settings?.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;
  return {
    ...parsed,
    version: STATE_VERSION,
    // D-2: fill every required root field that may be absent in older blobs.
    campaigns: (parsed.campaigns ?? []).map(repairCampaignSkillQueries),
    // STATE_VERSION 13 — backfill the TAnIA layer (lead source + star rating) on
    // any candidate that predates it, without clobbering explicit values.
    candidates: (parsed.candidates ?? []).map((c) => ({
      ...c,
      leadSource: c.leadSource ?? deriveLeadSource(c),
      starRating: c.starRating ?? deriveStarRating(c.matchScore, starT),
    })),
    // STATE_VERSION 13 — inbound chatbox queue.
    chatboxSubmissions: parsed.chatboxSubmissions ?? [],
    outreach: parsed.outreach ?? [],
    replies: parsed.replies ?? [],
    bookings: parsed.bookings ?? [],
    wins: parsed.wins ?? [],
    reports: parsed.reports ?? [],
    // STATE_VERSION 16 — re-sync each stored integration's `real` flag against
    // the current seed. Roadmap placeholders (`real: false`) also lose any older
    // fabricated connected/lastSync state; real cards keep their usage history.
    integrations: applyHarvestKeysToIntegrations(
      mergeSeedIntegrations(parsed.integrations ?? defaultIntegrations()),
      parsed.apiKeys ?? [],
    ),
    activities: parsed.activities ?? [],
    activeCampaignId: parsed.activeCampaignId ?? null,
    apiKeys: parsed.apiKeys ?? [],
    currentRole: parsed.currentRole ?? "admin",
    skills: parsed.skills ?? [],
    suppression: parsed.suppression ?? [],
    ledger: parsed.ledger ?? [],
    // Inbound-email dedup ledger — initialise on upgrade so re-sync after an
    // upgrade can't double-create replies for already-ingested messages.
    ingestedMessageIds: parsed.ingestedMessageIds ?? [],
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
  return {
    ...parsed,
    campaigns: (parsed.campaigns ?? []).map(repairCampaignSkillQueries),
    wins: parsed.wins ?? [],
    settings: withoutLegacyIntegrationAuthority(parsed.settings),
    integrations: applyHarvestKeysToIntegrations(
      mergeSeedIntegrations(parsed.integrations ?? []),
      parsed.apiKeys ?? [],
    ),
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
