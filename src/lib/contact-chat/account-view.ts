/**
 * Client-safe HeyReach account status.
 * The token itself is never part of this shape.
 */

export const LINKEDIN_ACCOUNT_SETTINGS_PATH = "/settings#linkedin-account";

export const HEYREACH_CHANNEL = "heyreach" as const;

export interface AccountView {
  channel: typeof HEYREACH_CHANNEL;
  enabled: boolean;
  tokenConfigured: boolean;
  addAccount: boolean;
  settingsPath: typeof LINKEDIN_ACCOUNT_SETTINGS_PATH;
}

export interface AccountPrompt {
  tone: "account" | "channel";
  message: string;
  settingsPath: typeof LINKEDIN_ACCOUNT_SETTINGS_PATH;
}

export function accountView(snapshot: { enabled: boolean; tokenConfigured: boolean }): AccountView {
  return {
    channel: HEYREACH_CHANNEL,
    enabled: snapshot.enabled,
    tokenConfigured: snapshot.tokenConfigured,
    addAccount: !snapshot.tokenConfigured,
    settingsPath: LINKEDIN_ACCOUNT_SETTINGS_PATH,
  };
}

/** What the chat shows when a send cannot leave the building. */
export function accountPrompt(view: AccountView): AccountPrompt | null {
  if (!view.tokenConfigured) {
    return {
      tone: "account",
      message: "Add your account in Settings. HeyReach needs a token before this chat can send.",
      settingsPath: view.settingsPath,
    };
  }
  if (!view.enabled) {
    return {
      tone: "channel",
      message: "HeyReach is off. Turn it on in Settings before a message can send.",
      settingsPath: view.settingsPath,
    };
  }
  return null;
}

export function channelOffMessage(): string {
  return "HeyReach is off. Turn it on in Settings to send this message.";
}

export function missingTokenMessage(): string {
  return "Add your account in Settings. HeyReach has no token yet, so nothing was sent.";
}
