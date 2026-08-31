/**
 * People-first roles (finance / trading-platform / application support) need
 * LinkedIn and/or Apify. GitHub Sourcing — even when the Settings card is
 * toggled Live while unconfigured — is not a people source.
 */
import { roleProfile } from "@/lib/roles";
import type { IntegrationStatus, JobAnalysis } from "@/lib/types";

export const MISSING_PEOPLE_PLUGINS_TOAST =
  "MISSING_PLUGIN: Connect LinkedIn and Apify in Settings. GitHub Sourcing cannot fill this role, even when toggled Live.";

const PEOPLE_PLUGIN_IDS = new Set(["int_apify", "int_linkedin_rsc"]);

const GENERIC_SOURCING_FAILURE =
  /invalid (response|result)|selected sourcing provider is not configured|sourcing agent (is unavailable|did not complete|could not be reached|returned an invalid)/i;

export function isPeopleFirstRole(job: JobAnalysis): boolean {
  return roleProfile(job).queryStyle === "linkedin";
}

export function peopleSourcePluginsConnected(
  integrations: readonly IntegrationStatus[],
): boolean {
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
): string | null {
  if (!isPeopleFirstRole(job) || peopleSourcePluginsConnected(integrations)) return null;
  return MISSING_PEOPLE_PLUGINS_TOAST;
}

export function remapPeopleFirstSourcingError(
  error: string,
  job: JobAnalysis,
  _integrations?: readonly IntegrationStatus[],
): string {
  if (!isPeopleFirstRole(job)) return error;
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
  const remapped = job ? remapPeopleFirstSourcingError(error, job, integrations) : error;
  if (
    !remapped.includes("MISSING_PLUGIN") &&
    !/Connect LinkedIn and Apify/i.test(remapped)
  ) {
    return null;
  }
  return {
    title: "Connect LinkedIn and Apify",
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
): boolean {
  if (peopleSourcePluginsConnected(all)) return true;
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
): boolean {
  if (integration.mode !== "live" || integration.status !== "connected") return false;
  if (integration.id === "int_github" && !githubLiveAllowed(all, job)) return false;
  return true;
}

export function emptyPeopleFirstShortlistError(
  job: JobAnalysis,
  integrations: readonly IntegrationStatus[],
  result: { accepted: { length: number }; source?: string },
): string | null {
  if (result.accepted.length > 0 || !isPeopleFirstRole(job)) return null;
  if (result.source === "github" || missingPeoplePluginsToast(job, integrations)) {
    return MISSING_PEOPLE_PLUGINS_TOAST;
  }
  return null;
}
