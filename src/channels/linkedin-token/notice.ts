/**
 * Client-safe constants for the LinkedIn session-token channel.
 * The channel is off until an owner or admin records this notice.
 */

export const RISK_NOTICE =
  "LinkedIn's User Agreement prohibits third-party session-token tools. The account may be restricted or banned.";

/** The only path PR #168's negative test should allow. */
export const COMPLIANCE_168_ALLOWLIST = ["src/channels/linkedin-token/"] as const;

export const TOKEN_CHANNEL = "linkedin-token";

/** The flag is stored per workspace. No environment name turns it on. */
export function flagDefaultsOff(_environment: string): boolean {
  return false;
}
