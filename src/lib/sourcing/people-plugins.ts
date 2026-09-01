/**
 * People-first roles (finance / trading-platform / application support) need
 * LinkedIn and/or Apify. GitHub Sourcing is not a people source.
 */
import { roleProfile } from "@/lib/roles";
import {
  CONNECT_APIFY_HREF,
  CONNECT_APIFY_LABEL,
  SOURCE_VIA_APIFY_HREF,
  SOURCE_VIA_APIFY_LABEL,
} from "@/lib/sourcing/harvest-evidence";
import {
  FIXTURE_NOT_ON_LIVE,
  FIXTURE_NOT_ON_LIVE_TOAST,
} from "@/lib/sourcing/lab-fixture-people";
import {
  apifyIntegrationIsMock,
  hasLiveApifyHarvest,
  isConnectOrDryRunCopy,
} from "@/lib/sourcing/people-connect";
import type { ApiKey, IntegrationStatus, JobAnalysis } from "@/lib/types";

export const MISSING_PEOPLE_PLUGINS_TOAST =
  "MISSING_PLUGIN: Add a valid Apify key in Access & Keys, or connect official LinkedIn. GitHub Sourcing cannot fill this people-first role.";

export const EMPTY_PEOPLE_FIRST_HARVEST =
  "Empty harvest is not a result. Do not stop at 0 people.";

export const PEOPLE_FIRST_HARVEST_UNAVAILABLE =
  "People-first harvest did not complete. Open Access & Keys to confirm the Apify key, then retry Source next batch.";

export const MOCK_APIFY_TOAST =
  "Apify is in Mock mode. Source next batch will not harvest on Mock. Connect a real Apify key and switch the card to Live.";

export const CROSS_ORIGIN_SOURCING_TOAST =
  "This request was blocked as cross-origin. Source next batch from the product host — do not treat this as 0 people.";

export const SOURCING_AGENT_UNAVAILABLE_TOAST =
  "Sourcing is unavailable. This is not 0 people. Retry Source next batch from the product host.";

export const PEOPLE_PLUGIN_SETTINGS_HREF = "/settings";
export const PEOPLE_PLUGIN_SETTINGS_LABEL = "Open Access & Keys";
export const CAMPAIGN_NOT_READY_TOAST =
  "Complete and review the campaign brief before sourcing.";

const OFFICIAL_LINKEDIN_PLUGIN_IDS = new Set(["int_linkedin_rsc"]);

const GENERIC_SOURCING_FAILURE =
  /invalid (response|result)|selected sourcing provider is not configured|sourcing agent (is unavailable|did not complete|could not be reached|returned an invalid)|sourcing request failed/i;

export function isPeopleFirstRole(job: JobAnalysis): boolean {
  return roleProfile(job).queryStyle === "linkedin";
}

export { hasValidApifyKey, hasValidHeyReachKey } from "@/lib/sourcing/people-connect";

export function peopleSourcePluginsConnected(
  integrations: readonly IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): boolean {
  if (hasLiveApifyHarvest(integrations, apiKeys)) return true;
  return integrations.some(
    (item) =>
      (OFFICIAL_LINKEDIN_PLUGIN_IDS.has(item.id) || item.id.startsWith("int_linkedin")) &&
      item.status === "connected" &&
      item.mode === "live",
  );
}

export function missingPeoplePluginsToast(
  job: JobAnalysis,
  integrations: readonly IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): string | null {
  if (!isPeopleFirstRole(job)) return null;
  if (apifyIntegrationIsMock(integrations)) return MOCK_APIFY_TOAST;
  if (peopleSourcePluginsConnected(integrations, apiKeys)) return null;
  return MISSING_PEOPLE_PLUGINS_TOAST;
}

export function remapPeopleFirstSourcingError(
  error: string,
  job: JobAnalysis,
  integrations?: readonly IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): string {
  if (!isPeopleFirstRole(job)) return error;
  if (isConnectOrDryRunCopy(error)) return error;
  if (
    error === CROSS_ORIGIN_SOURCING_TOAST ||
    error.includes("CROSS_ORIGIN_REQUEST") ||
    /cross-origin/i.test(error)
  ) {
    return CROSS_ORIGIN_SOURCING_TOAST;
  }
  if (
    error === SOURCING_AGENT_UNAVAILABLE_TOAST ||
    error.includes("SOURCING_AGENT_UNAVAILABLE") ||
    /Live sourcing(?:-agent)? authority is unavailable|Campaign authority is unavailable|Sourcing is unavailable/i.test(
      error,
    )
  ) {
    return SOURCING_AGENT_UNAVAILABLE_TOAST;
  }
  if (apifyIntegrationIsMock(integrations ?? [])) {
    if (/actor=harvestapi/.test(error) && /Mock mode/.test(error)) return error;
    if (
      error === MOCK_APIFY_TOAST ||
      /Mock mode/.test(error) ||
      error.includes("MISSING_PLUGIN") ||
      GENERIC_SOURCING_FAILURE.test(error)
    ) {
      return MOCK_APIFY_TOAST;
    }
    return error;
  }
  const keyed = peopleSourcePluginsConnected(integrations ?? [], apiKeys);
  if (keyed) {
    if (error.includes("MISSING_PLUGIN")) return EMPTY_PEOPLE_FIRST_HARVEST;
    if (GENERIC_SOURCING_FAILURE.test(error)) return PEOPLE_FIRST_HARVEST_UNAVAILABLE;
    return error;
  }
  if (error.includes("MISSING_PLUGIN") || GENERIC_SOURCING_FAILURE.test(error)) {
    return MISSING_PEOPLE_PLUGINS_TOAST;
  }
  return error;
}

export function isGithubOnlyEmptyBatch(input: {
  candidates: readonly { sourcePlatform?: string }[];
  feedbackReceipts: readonly { platform: string }[];
}): boolean {
  return (
    input.candidates.length === 0 &&
    input.feedbackReceipts.length > 0 &&
    input.feedbackReceipts.every((receipt) => receipt.platform === "GitHub")
  );
}

export type PeoplePluginUi = {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
};

function pluginUi(title: string, description: string): PeoplePluginUi {
  return {
    title,
    description,
    href: PEOPLE_PLUGIN_SETTINGS_HREF,
    actionLabel: PEOPLE_PLUGIN_SETTINGS_LABEL,
  };
}

function isCampaignBriefError(error: string): boolean {
  return (
    error === CAMPAIGN_NOT_READY_TOAST ||
    error.includes("CAMPAIGN_NOT_READY") ||
    /campaign_invalid_state/i.test(error) ||
    /complete and review the campaign brief/i.test(error) ||
    /campaign brief requires review/i.test(error)
  );
}

function campaignBriefUi(description: string): PeoplePluginUi {
  return {
    title: "Campaign needs review",
    description: /complete and review the campaign brief/i.test(description)
      ? description
      : CAMPAIGN_NOT_READY_TOAST,
    href: "",
    actionLabel: "",
  };
}

/** Keyed harvest fail after the engine already next-searched. Not a reconnect. */
function keyedEmptyHarvestUi(description: string): PeoplePluginUi {
  return {
    title: "Empty harvest is not a result",
    description,
    href: SOURCE_VIA_APIFY_HREF,
    actionLabel: SOURCE_VIA_APIFY_LABEL,
  };
}

/** Never null. A rejected Source next batch POST must not be silent 0. */
export function sourceRejectedToast(
  error: string,
  job?: JobAnalysis,
  integrations?: readonly IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): PeoplePluginUi {
  const failLoud = peoplePluginFailLoudUi(error, job, integrations, apiKeys);
  if (failLoud) return failLoud;
  const remapped = job ? remapPeopleFirstSourcingError(error, job, integrations, apiKeys) : error;
  const description = remapped.trim() || CROSS_ORIGIN_SOURCING_TOAST;
  if (description === CROSS_ORIGIN_SOURCING_TOAST || /cross-origin/i.test(description)) {
    return pluginUi("Sourcing failed", CROSS_ORIGIN_SOURCING_TOAST);
  }
  if (isCampaignBriefError(description) || isCampaignBriefError(error)) {
    return campaignBriefUi(description);
  }
  if (
    description === SOURCING_AGENT_UNAVAILABLE_TOAST ||
    /Sourcing is unavailable/i.test(description)
  ) {
    return pluginUi("Sourcing failed", SOURCING_AGENT_UNAVAILABLE_TOAST);
  }
  return pluginUi("Sourcing failed", description);
}

export function peoplePluginFailLoudUi(
  error: string,
  job?: JobAnalysis,
  integrations?: readonly IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): PeoplePluginUi | null {
  if (isConnectOrDryRunCopy(error)) return null;
  const remapped = job ? remapPeopleFirstSourcingError(error, job, integrations, apiKeys) : error;
  if (remapped === CROSS_ORIGIN_SOURCING_TOAST || /cross-origin/i.test(remapped)) {
    return pluginUi("Sourcing failed", remapped);
  }
  if (isCampaignBriefError(remapped) || isCampaignBriefError(error)) {
    return campaignBriefUi(remapped);
  }
  if (remapped === SOURCING_AGENT_UNAVAILABLE_TOAST || /Sourcing is unavailable/i.test(remapped)) {
    return pluginUi("Sourcing failed", SOURCING_AGENT_UNAVAILABLE_TOAST);
  }
  if (
    remapped === MOCK_APIFY_TOAST ||
    remapped === FIXTURE_NOT_ON_LIVE_TOAST ||
    remapped.includes(FIXTURE_NOT_ON_LIVE) ||
    remapped.includes("PEOPLE_FIRST_HARVEST_MOCK") ||
    /Mock mode|lab fixtures are not linkedin/i.test(remapped)
  ) {
    return {
      title: CONNECT_APIFY_LABEL,
      description: remapped,
      href: CONNECT_APIFY_HREF,
      actionLabel: CONNECT_APIFY_LABEL,
    };
  }
  if (
    remapped === EMPTY_PEOPLE_FIRST_HARVEST ||
    /0 candidates|empty harvest|0 profiles|do not stop at 0|did not start|still running|aborted after|actor=harvestapi/i.test(remapped)
  ) {
    const keyed = job ? peopleSourcePluginsConnected(integrations ?? [], apiKeys) : false;
    return keyed ? keyedEmptyHarvestUi(remapped) : pluginUi("Empty harvest is not a result", remapped);
  }
  if (remapped === PEOPLE_FIRST_HARVEST_UNAVAILABLE || GENERIC_SOURCING_FAILURE.test(remapped)) {
    return pluginUi("Sourcing failed", remapped);
  }
  if (
    !remapped.includes("MISSING_PLUGIN") &&
    !/Connect LinkedIn and Apify/i.test(remapped) &&
    !/Add a valid Apify key/i.test(remapped)
  ) {
    return null;
  }
  return {
    title: CONNECT_APIFY_LABEL,
    description: remapped.includes("MISSING_PLUGIN") ? remapped : MISSING_PEOPLE_PLUGINS_TOAST,
    href: CONNECT_APIFY_HREF,
    actionLabel: CONNECT_APIFY_LABEL,
  };
}

/**
 * Campaign activity notes for a people-first fail-loud. Toast copy stays the
 * remapped operator text; the row also keeps the stdout code so late
 * read-only can grep Mock / unavailable after the toast is gone.
 */
export function peopleFirstFailActivityNotes(error: string): string {
  const trimmed = error.trim();
  if (!trimmed) return trimmed;
  if (
    /Mock mode|PEOPLE_FIRST_HARVEST_MOCK/i.test(trimmed) &&
    !trimmed.includes("PEOPLE_FIRST_HARVEST_MOCK")
  ) {
    return `PEOPLE_FIRST_HARVEST_MOCK — ${trimmed}`;
  }
  if (
    /lab fixtures are not linkedin|FIXTURE_NOT_ON_LIVE/i.test(trimmed) &&
    !trimmed.includes("FIXTURE_NOT_ON_LIVE")
  ) {
    return `FIXTURE_NOT_ON_LIVE — ${trimmed}`;
  }
  if (
    /Sourcing is unavailable|SOURCING_AGENT_UNAVAILABLE/i.test(trimmed) &&
    !trimmed.includes("SOURCING_AGENT_UNAVAILABLE")
  ) {
    return `SOURCING_AGENT_UNAVAILABLE — ${trimmed}`;
  }
  return trimmed;
}

export function peopleFirstFailActivity(error: string): { title: string; notes: string } {
  const notes = peopleFirstFailActivityNotes(error);
  const ui = peoplePluginFailLoudUi(error) ?? sourceRejectedToast(error);
  return { title: ui.title, notes };
}

export function emptyPeopleFirstToast(
  job: JobAnalysis,
  integrations: readonly IntegrationStatus[],
  result: { accepted: { length: number }; source?: string },
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): PeoplePluginUi | null {
  const description = emptyPeopleFirstShortlistError(job, integrations, result, apiKeys);
  if (!description) return null;
  if (peopleSourcePluginsConnected(integrations, apiKeys)) {
    return keyedEmptyHarvestUi(description);
  }
  return {
    title: CONNECT_APIFY_LABEL,
    description,
    href: CONNECT_APIFY_HREF,
    actionLabel: CONNECT_APIFY_LABEL,
  };
}

/**
 * GitHub may be Live only when it is actually connected. On a people-first
 * need — or when no need is loaded yet — LinkedIn and Apify must also be
 * keyed. A GitHub-first software role can still show GitHub Live alone.
 */
export function githubLiveAllowed(
  all: readonly IntegrationStatus[],
  job?: JobAnalysis | null,
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): boolean {
  if (peopleSourcePluginsConnected(all, apiKeys)) return true;
  return Boolean(job && !isPeopleFirstRole(job));
}

/**
 * Honest Live badge. Unconfigured cards are not Live. GitHub is not Live on a
 * people-first (or unknown) need when LinkedIn and Apify are unconfigured.
 */
export function integrationShowsLive(
  integration: Pick<IntegrationStatus, "id" | "mode" | "status">,
  all: readonly IntegrationStatus[],
  job?: JobAnalysis | null,
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): boolean {
  if (integration.id === "int_heyreach") return false;
  if (integration.mode !== "live" || integration.status !== "connected") return false;
  if (integration.id === "int_github" && !githubLiveAllowed(all, job, apiKeys)) return false;
  return true;
}

/**
 * Stale GitHub 0-row learning receipts must not render as a real GitHub run
 * on a people-first need while LinkedIn and Apify are unkeyed — or at all
 * when the GitHub row itself is empty.
 */
export function visiblePeopleFirstLearningReceipts<
  T extends { platform: string; candidateCount: number },
>(
  receipts: readonly T[],
  job: JobAnalysis,
  integrations: readonly IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): T[] {
  if (!isPeopleFirstRole(job)) return [...receipts];
  const peopleKeyed = peopleSourcePluginsConnected(integrations, apiKeys);
  return receipts.filter((receipt) => {
    if (receipt.candidateCount === 0) return false;
    if (receipt.platform !== "GitHub") return true;
    if (!peopleKeyed) return false;
    return receipt.candidateCount > 0;
  });
}

export function emptyPeopleFirstShortlistError(
  job: JobAnalysis,
  integrations: readonly IntegrationStatus[],
  result: { accepted: { length: number }; source?: string },
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): string | null {
  if (result.accepted.length > 0 || !isPeopleFirstRole(job)) return null;
  if (apifyIntegrationIsMock(integrations)) return MOCK_APIFY_TOAST;
  if (peopleSourcePluginsConnected(integrations, apiKeys)) {
    return EMPTY_PEOPLE_FIRST_HARVEST;
  }
  if (result.source === "mock") return MISSING_PEOPLE_PLUGINS_TOAST;
  if (result.source === "github" || missingPeoplePluginsToast(job, integrations, apiKeys)) {
    return MISSING_PEOPLE_PLUGINS_TOAST;
  }
  return null;
}
