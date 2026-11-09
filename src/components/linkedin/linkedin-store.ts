"use client";

import * as React from "react";
import { linkedInApi, postJson } from "./api";
import type { AccountInfo, Policy } from "./types";

/* One shared, live view of the user's LinkedIn bridge for the whole tab:
 * the account (Settings), and each sourced candidate's LinkedIn standing (the
 * candidate list badges and the candidate drawer). A single EventSource on
 * /api/linkedin/stream drives it while at least one component listens. */

export type Relationship = "unknown" | "connected" | "pending" | "none" | "not_found";

export type PendingWrite = {
  id: string;
  kind: "message" | "invitation";
  status: "queued" | "resolving" | "sending" | "failed" | "unknown";
  error: string | null;
  body: string;
  createdAt: string;
};

export type CandidateLinkedIn = {
  candidateId: string;
  relationship: Relationship;
  displayName: string | null;
  headline: string | null;
  checking: boolean;
  checkedAt: string | null;
  lookupError: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
  conversation: {
    id: string;
    unread: boolean;
    lastActivityAt: string | null;
    lastDirection: "inbound" | "outbound" | null;
    preview: string | null;
  } | null;
  pending: PendingWrite | null;
};

export type AccountView = {
  paired: boolean;
  account: (AccountInfo & { extensionOutdated?: boolean; minExtensionVersion?: string }) | null;
  policy: Policy & { dailyInviteCap?: number; weeklyInviteCap?: number };
  unread: number;
};

export type LinkedInState = {
  status: "idle" | "loading" | "disabled" | "unavailable" | "ready";
  detail: string;
  account: AccountView | null;
  contacts: ReadonlyMap<string, CandidateLinkedIn>;
  inviteNoteLimit: number;
  /** When the next queued message or invitation may leave (LinkedIn pacing), if later than now. */
  nextWriteAt: string | null;
  /** Bumps when a conversation or the outbox may have changed: open threads refetch. */
  threadTick: number;
  transport: "connecting" | "live" | "polling";
};

const EMPTY: LinkedInState = {
  status: "idle",
  detail: "",
  account: null,
  contacts: new Map(),
  inviteNoteLimit: 300,
  nextWriteAt: null,
  threadTick: 0,
  transport: "connecting",
};

let state: LinkedInState = EMPTY;
const listeners = new Set<() => void>();
let source: EventSource | null = null;
let poll: number | null = null;
let closeTimer: number | null = null;
let refetchTimer: number | null = null;

function set(patch: Partial<LinkedInState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

async function loadAccount(): Promise<boolean> {
  const res = await linkedInApi<AccountView>("/api/linkedin/account");
  if (!res.ok) {
    set({ status: res.disabled ? "disabled" : "unavailable", detail: res.error });
    return false;
  }
  set({ account: { paired: res.data.paired, account: res.data.account ?? null, policy: res.data.policy, unread: res.data.unread ?? 0 } });
  return true;
}

async function loadContacts() {
  const res = await linkedInApi<{ paired: boolean; contacts: CandidateLinkedIn[]; inviteNoteLimit?: number; nextWriteAt?: string | null }>(
    "/api/linkedin/candidates",
  );
  if (!res.ok) return;
  set({
    contacts: new Map(res.data.contacts.map((c) => [c.candidateId, c])),
    inviteNoteLimit: res.data.inviteNoteLimit ?? 300,
    nextWriteAt: res.data.nextWriteAt ?? null,
  });
}

export async function refreshLinkedIn() {
  if (!(await loadAccount())) return;
  await loadContacts();
  set({ status: "ready", threadTick: state.threadTick + 1 });
}

function scheduleRefetch(parts: string[]) {
  if (refetchTimer !== null) window.clearTimeout(refetchTimer);
  refetchTimer = window.setTimeout(() => {
    refetchTimer = null;
    if (parts.includes("status") || parts.includes("outbox") || parts.includes("inbox")) void loadAccount();
    if (parts.some((p) => p !== "status")) void loadContacts();
    if (parts.includes("inbox") || parts.includes("outbox")) set({ threadTick: state.threadTick + 1 });
  }, 150);
}

function openStream() {
  if (source || poll !== null) return;
  let opened = false;
  let failures = 0;
  source = new EventSource("/api/linkedin/stream");
  source.onopen = () => {
    opened = true;
    failures = 0;
    set({ transport: "live" });
  };
  source.addEventListener("change", (event) => {
    try {
      scheduleRefetch((JSON.parse((event as MessageEvent<string>).data) as { parts?: string[] }).parts ?? []);
    } catch {
      // ignore a malformed event
    }
  });
  source.onerror = () => {
    failures += 1;
    if ((!opened && failures >= 3) || failures >= 8) {
      source?.close();
      source = null;
      set({ transport: "polling" });
      poll = window.setInterval(() => void refreshLinkedIn(), 10_000);
    } else {
      set({ transport: "connecting" });
    }
  };
}

function closeStream() {
  source?.close();
  source = null;
  if (poll !== null) window.clearInterval(poll);
  poll = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (state.status === "idle") {
    set({ status: "loading" });
    void refreshLinkedIn().then(() => {
      if (state.status === "ready" && listeners.size) openStream();
    });
  } else if (state.status === "ready") {
    openStream();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      // Survive a remount (drawer closing and opening) without reconnecting.
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        if (!listeners.size) closeStream();
      }, 5000);
    }
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export function useLinkedIn(): LinkedInState {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useCandidateLinkedIn(candidateId: string): { state: LinkedInState; contact: CandidateLinkedIn | null } {
  const current = useLinkedIn();
  return { state: current, contact: current.contacts.get(candidateId) ?? null };
}

// ── Actions (each one a click by the user) ─────────────────────────────────

export async function checkCandidate(candidateId: string) {
  const res = await linkedInApi("/api/linkedin/candidates", postJson({ action: "check", candidateId }));
  if (res.ok) void loadContacts();
  return res;
}

/** Look a LinkedIn profile up before adding it as a candidate. Its standing
 *  then shows under `useCandidateLinkedIn(prospectId)`. */
export async function previewProspect(linkedinUrl: string) {
  const res = await linkedInApi<{ prospectId: string; identity: string }>("/api/linkedin/candidates", postJson({ action: "preview", linkedinUrl }));
  if (res.ok) void loadContacts();
  return res;
}

/** The looked-up profile became this candidate: its LinkedIn standing carries over. */
export async function adoptProspect(prospectId: string, candidateId: string) {
  const res = await linkedInApi("/api/linkedin/candidates", postJson({ action: "adopt", prospectId, candidateId }));
  // Known before the candidate's panel opens, so it does not look them up again.
  if (res.ok) firstLooks.add(candidateId);
  await loadContacts();
  return res;
}

export async function discardProspect(prospectId: string) {
  const res = await linkedInApi("/api/linkedin/candidates", postJson({ action: "discard", prospectId }));
  void loadContacts();
  return res;
}

const firstLooks = new Set<string>();

/**
 * The first look at a candidate on LinkedIn (relationship, conversation),
 * once per candidate and tab: LinkedIn counts each look as a profile view.
 * Null when it already ran; a failed look can be retried.
 */
export function firstLookCandidate(candidateId: string): Promise<Awaited<ReturnType<typeof checkCandidate>>> | null {
  if (firstLooks.has(candidateId)) return null;
  firstLooks.add(candidateId);
  return checkCandidate(candidateId).then((res) => {
    if (!res.ok) firstLooks.delete(candidateId);
    return res;
  });
}

export async function inviteCandidate(candidateId: string, note: string) {
  const res = await linkedInApi("/api/linkedin/candidates", postJson({ action: "invite", candidateId, note }));
  if (res.ok) void loadContacts();
  return res;
}

export async function messageCandidate(candidateId: string, text: string) {
  const res = await linkedInApi("/api/linkedin/outbox", postJson({ candidateId, text }));
  if (res.ok) void loadContacts();
  return res;
}

export async function withdraw(outboxId: string) {
  const res = await linkedInApi(`/api/linkedin/outbox?id=${outboxId}`, { method: "DELETE" });
  void loadContacts();
  return res;
}
