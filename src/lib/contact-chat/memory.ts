import { createHash, randomUUID } from "crypto";
import {
  accountView,
  type AccountView,
  LINKEDIN_ACCOUNT_SETTINGS_PATH,
} from "./account-view";

/**
 * Server-only HeyReach account memory.
 * The token is kept here and is not copied into AccountView.
 * This module must not be imported from a client component.
 */
if (typeof window !== "undefined") {
  throw new Error("HeyReach account memory is server-only.");
}

export interface StoredApproval {
  personId: string;
  textHash: string;
  used: boolean;
}

export interface StoredMessage {
  id: string;
  text: string;
  at: string;
}

export interface StoredThread {
  id: string;
  personId: string;
  messages: StoredMessage[];
}

interface Memory {
  enabled: boolean;
  token: string;
  approvals: StoredApproval[];
  threads: Map<string, StoredThread>;
}

function fresh(): Memory {
  return { enabled: false, token: "", approvals: [], threads: new Map() };
}

const SLOT = "__ariaContactChatMemory";

function current(): Memory {
  const bag = globalThis as typeof globalThis & { [SLOT]?: Memory };
  if (!bag[SLOT]) bag[SLOT] = fresh();
  return bag[SLOT];
}

function replace(next: Memory): void {
  (globalThis as typeof globalThis & { [SLOT]?: Memory })[SLOT] = next;
}

const PERSON_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isPersonId(value: string): boolean {
  return PERSON_ID.test(value);
}

export function threadIdFor(personId: string): string {
  return `thread_${personId}`;
}

export function exactTextHash(personId: string, text: string): string {
  return createHash("sha256").update(`${personId}\n${text}`, "utf8").digest("hex");
}

/** LinkedIn session cookies are not a HeyReach token. */
export function looksLikeLinkedInSession(value: string): boolean {
  return /li_at|jsessionid|liap|voyager|linkedin\.com/i.test(value);
}

export function resetContactChatMemory(): void {
  replace(fresh());
}

export function linkedInAccountView(): AccountView {
  const memory = current();
  return accountView({
    enabled: memory.enabled,
    tokenConfigured: memory.token.length > 0,
  });
}

export function heyReachEnabled(): boolean {
  return current().enabled;
}

export function heyReachTokenConfigured(): boolean {
  return current().token.length > 0;
}

/** Test helper. Returns whether the stored token equals `value`. Never returns the token. */
export function storedTokenEquals(value: string): boolean {
  return value.length > 0 && current().token === value;
}

export type TokenWriteResult =
  | { ok: true; account: AccountView }
  | { ok: false; reason: "empty" | "session-cookie"; message: string; account: AccountView };

export function putLinkedInAccountToken(value: string): TokenWriteResult {
  const token = value ?? "";
  if (!token.trim()) {
    return {
      ok: false,
      reason: "empty",
      message: "Paste a HeyReach token to add your account.",
      account: linkedInAccountView(),
    };
  }
  if (looksLikeLinkedInSession(token)) {
    return {
      ok: false,
      reason: "session-cookie",
      message: "This field stores a HeyReach token. LinkedIn session cookies are not accepted.",
      account: linkedInAccountView(),
    };
  }
  replace({ ...current(), token, enabled: false });
  return { ok: true, account: linkedInAccountView() };
}

export type EnableResult =
  | { ok: true; account: AccountView }
  | {
      ok: false;
      reason: "missing-token";
      message: string;
      settingsPath: typeof LINKEDIN_ACCOUNT_SETTINGS_PATH;
      account: AccountView;
    };

export function setHeyReachEnabled(on: boolean): EnableResult {
  if (on && current().token.length === 0) {
    return {
      ok: false,
      reason: "missing-token",
      message: "Add your account in Settings before turning HeyReach on.",
      settingsPath: LINKEDIN_ACCOUNT_SETTINGS_PATH,
      account: linkedInAccountView(),
    };
  }
  replace({ ...current(), enabled: on });
  return { ok: true, account: linkedInAccountView() };
}

export function approveExactText(personId: string, text: string): { ok: true } | { ok: false; reason: "person" | "text"; message: string } {
  const trimmed = text ?? "";
  if (!isPersonId(personId)) return { ok: false, reason: "person", message: "Choose a person first." };
  if (!trimmed.trim()) return { ok: false, reason: "text", message: "Type a message before approving it." };
  const exact = trimmed.trim();
  const textHash = exactTextHash(personId, exact);
  const existing = current().approvals.find((row) => row.personId === personId && row.textHash === textHash && !row.used);
  if (!existing) {
    current().approvals.push({ personId, textHash, used: false });
  }
  return { ok: true };
}

export function takeExactApproval(personId: string, text: string): boolean {
  const textHash = exactTextHash(personId, text);
  const row = current().approvals.find((item) => item.personId === personId && item.textHash === textHash && !item.used);
  if (!row) return false;
  row.used = true;
  return true;
}

export function releaseExactApproval(personId: string, text: string): void {
  const textHash = exactTextHash(personId, text);
  const row = current().approvals.find((item) => item.personId === personId && item.textHash === textHash && item.used);
  if (row) row.used = false;
}

export function openThread(personId: string): StoredThread {
  const id = threadIdFor(personId);
  const existing = current().threads.get(personId);
  if (existing) return existing;
  const created: StoredThread = { id, personId, messages: [] };
  current().threads.set(personId, created);
  return created;
}

export function appendThreadMessage(personId: string, text: string): StoredThread {
  const thread = openThread(personId);
  thread.messages.push({
    id: `cmsg_${randomUUID()}`,
    text,
    at: new Date().toISOString(),
  });
  return thread;
}
