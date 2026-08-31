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
  integrations: readonly IntegrationStatus[],
): string {
  const missing = missingPeoplePluginsToast(job, integrations);
  if (!missing) return error;
  if (error.includes("MISSING_PLUGIN") || GENERIC_SOURCING_FAILURE.test(error)) {
    return missing;
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
