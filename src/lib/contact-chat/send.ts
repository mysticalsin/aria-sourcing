import {
  channelOffMessage,
  missingTokenMessage,
  LINKEDIN_ACCOUNT_SETTINGS_PATH,
  type AccountView,
} from "./account-view";
import { demoHeyReachTransport, type HeyReachMcpTransport } from "./heyreach-mcp";
import {
  appendThreadMessage,
  heyReachEnabled,
  heyReachTokenConfigured,
  isPersonId,
  linkedInAccountView,
  openThread,
  releaseExactApproval,
  takeExactApproval,
  type StoredMessage,
} from "./memory";

export type ContactSendResult =
  | {
      ok: true;
      providerMessageId: string;
      messages: StoredMessage[];
      account: AccountView;
    }
  | {
      ok: false;
      reason: "channel-off" | "missing-token" | "approval" | "person" | "text";
      message: string;
      settingsPath?: typeof LINKEDIN_ACCOUNT_SETTINGS_PATH;
      account: AccountView;
    };

export async function sendContactMessage(
  input: { personId: string; text: string },
  transport: HeyReachMcpTransport = demoHeyReachTransport(),
): Promise<ContactSendResult> {
  const account = linkedInAccountView();
  const personId = input.personId ?? "";
  const text = (input.text ?? "").trim();
  if (!isPersonId(personId)) {
    return { ok: false, reason: "person", message: "Choose a person first.", account };
  }
  if (!text) {
    return { ok: false, reason: "text", message: "Type a message before sending.", account };
  }
  if (!heyReachEnabled()) {
    return {
      ok: false,
      reason: "channel-off",
      message: channelOffMessage(),
      settingsPath: LINKEDIN_ACCOUNT_SETTINGS_PATH,
      account,
    };
  }
  if (!heyReachTokenConfigured()) {
    return {
      ok: false,
      reason: "missing-token",
      message: missingTokenMessage(),
      settingsPath: LINKEDIN_ACCOUNT_SETTINGS_PATH,
      account,
    };
  }
  if (!takeExactApproval(personId, text)) {
    return {
      ok: false,
      reason: "approval",
      message: "Approve this exact text before sending it.",
      account,
    };
  }
  try {
    const sent = await transport.call(
      "send_message",
      { personId, text },
      { tokenPresent: true },
    );
    const thread = appendThreadMessage(personId, text);
    return { ok: true, providerMessageId: sent.id, messages: thread.messages, account: linkedInAccountView() };
  } catch {
    releaseExactApproval(personId, text);
    return {
      ok: false,
      reason: "approval",
      message: "HeyReach did not accept the message. Nothing was marked sent.",
      account: linkedInAccountView(),
    };
  }
}

export function readContactThread(personId: string): { id: string; personId: string; messages: StoredMessage[] } | null {
  if (!isPersonId(personId)) return null;
  const thread = openThread(personId);
  return { id: thread.id, personId: thread.personId, messages: thread.messages.map((message) => ({ ...message })) };
}
