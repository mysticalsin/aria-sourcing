/**
 * Fail-closed signal when a LinkedIn-first role cannot be filled without the
 * LinkedIn profile-search connector (Apify under the hood). GitHub Live alone
 * must not soft-empty these roles into weak name-matches.
 */

export const MISSING_PLUGIN_CODE = "MISSING_PLUGIN" as const;

/** Settings deep-link: Access & Keys → API keys panel (provider Apify). */
export const LINKEDIN_PROFILE_SEARCH_SETTINGS_HREF =
  "/settings?tab=access#api-keys-panel" as const;

export const MISSING_PLUGIN_MESSAGE =
  "Connect LinkedIn and Apify in Settings. GitHub Sourcing cannot fill this role, even when toggled Live." as const;

export function isLinkedInFirstPlatform(
  primaryPlatform: string | undefined | null,
): boolean {
  return (
    primaryPlatform === "LinkedIn" ||
    primaryPlatform === "Talent Pool" ||
    primaryPlatform === "Referral" ||
    primaryPlatform === "Dribbble" ||
    primaryPlatform === "Behance"
  );
}

export function missingPluginPayload() {
  return {
    code: MISSING_PLUGIN_CODE,
    error: MISSING_PLUGIN_MESSAGE,
    settingsHref: LINKEDIN_PROFILE_SEARCH_SETTINGS_HREF,
  } as const;
}
