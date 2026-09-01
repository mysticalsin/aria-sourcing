/**
 * People-first roles (finance / trading-platform / application support) need
 * LinkedIn and/or Apify. GitHub Sourcing — even when the Settings card is
 * toggled Live while unconfigured — is not a people source.
 */
import { roleProfile } from "@/lib/roles";
import {
  hasValidApifyKey,
  isConnectOrDryRunCopy,
} from "@/lib/sourcing/people-connect";
import type { ApiKey, IntegrationStatus, JobAnalysis } from "@/lib/types";

export const MISSING_PEOPLE_PLUGINS_TOAST =
  "MISSING_PLUGIN: Add a valid Apify key in Access & Keys, or connect official LinkedIn. GitHub Sourcing cannot fill this people-first role.";

const PEOPLE_PLUGIN_IDS = new Set(["int_apify", "int_linkedin_rsc"]);

const GENERIC_SOURCING_FAILURE =
  /invalid (response|result)|selected sourcing provider is not configured|sourcing agent (is unavailable|did not complete|could not be reached|returned an invalid)/i;

export function isPeopleFirstRole(job: JobAnalysis): boolean {
  return roleProfile(job).queryStyle === "linkedin";
}

export { hasValidApifyKey, hasValidHeyReachKey } from "@/lib/sourcing/people-connect";

export function peopleSourcePluginsConnected(
  integrations: readonly IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): boolean {
  if (hasValidApifyKey(apiKeys)) return true;
  return integrations.some(
    (item) =>
      (PEOPLE_PLUGIN_IDS.has(item.id) || item.id.startsWith("int_linkedin")) &&
      item.status === "connected" &&
      item.mode === "live",
  );
}

export function missingPeoplePluginsToast(
  job: JobAnalysis,
  integrations: readonly IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): string | null {
  if (!isPeopleFirstRole(job) || peopleSourcePluginsConnected(integrations, apiKeys)) return null;
  return MISSING_PEOPLE_PLUGINS_TOAST;
}

export function remapPeopleFirstSourcingError(
  error: string,
  job: JobAnalysis,
  _integrations?: readonly IntegrationStatus[],
): string {
  if (!isPeopleFirstRole(job)) return error;
  if (isConnectOrDryRunCopy(error)) return error;
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

export function peoplePluginFailLoudUi(
  error: string,
  job?: JobAnalysis,
  integrations?: readonly IntegrationStatus[],
): { title: string; description: string } | null {
  if (isConnectOrDryRunCopy(error)) return null;
  const remapped = job ? remapPeopleFirstSourcingError(error, job, integrations) : error;
  if (
    !remapped.includes("MISSING_PLUGIN") &&
    !/Connect LinkedIn and Apify/i.test(remapped)
  ) {
    return null;
  }
  return {
    title: "Add a valid Apify key",
    description: remapped.includes("MISSING_PLUGIN") ? remapped : MISSING_PEOPLE_PLUGINS_TOAST,
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
  if (result.source === "mock") return null;
  if (result.source === "github" || missingPeoplePluginsToast(job, integrations, apiKeys)) {
    return MISSING_PEOPLE_PLUGINS_TOAST;
  }
  return null;
}
