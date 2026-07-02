/* ============================================================================
   Aria Live (Demo Director) — a hands-free cinematic that plays the whole
   hire funnel end to end: source -> draft -> approve -> reply -> book ->
   report. It composes the REAL store actions (the same ones a recruiter
   would click one at a time) so every number on screen is a genuine result,
   never a fabricated one. It is a plain module (no React) so it can be
   triggered from two different UI surfaces (TopBar button, ⌘K palette)
   without lifting state into a shared React context.

   NON-DESTRUCTIVE BY DESIGN — read this before touching anything below.
   ---------------------------------------------------------------------
   There is no store action that can delete a candidate / outreach draft /
   reply / booking / report once created (by design — see store.ts's
   HermesActions), so the only way to guarantee the run leaves ZERO trace is
   a full-state snapshot + full-state restore, not a per-entity undo.

   The store (HermesProvider in store.ts) keeps its state in a plain
   `useState`, mounted once at the app root (see providers.tsx) and persisted
   to `localStorage["hermes-sourcing:v1"]` on a 600ms debounce (flushed
   immediately on `beforeunload`). There is no exposed action to replace that
   state wholesale with an arbitrary snapshot (`resetDemo` exists but always
   reseeds to `buildSeedState()`, not to "whatever the user had a moment
   ago") and store.ts is out of scope for this workstream. So restoring the
   LIVE in-memory state in place is not possible from outside store.ts.

   The only remaining lever — and the one this module uses — is the exact
   pattern TopBar's own "Reset to defaults" flow already relies on
   (`resetDemo(); window.location.href = "/"`): write the desired bytes to
   localStorage, then force a real navigation. A real navigation remounts
   HermesProvider, which re-hydrates from localStorage on mount (store.ts
   ~511-529) — that mount-time read is the only "rehydrate" entry point that
   exists, so a hard reload is how this module "triggers" it.

   The one subtlety that makes this safe rather than racy: HermesProvider's
   own `beforeunload` listener (registered at app boot) flushes whatever the
   LATEST in-memory state is to localStorage the moment a real navigation
   starts — which, at the end of an Aria Live run, is the run's *mutated*
   state, not the pre-run snapshot. Left alone that flush would clobber our
   restore. Browsers fire `beforeunload` listeners in registration order, and
   this module's own listener is only ever registered once a run starts
   (i.e. strictly after HermesProvider's, which is registered at boot) — so
   ours always fires second and its write is always the one left standing
   right before the page actually unloads. That guarantee holds whether the
   reload is one we trigger ourselves (Skip / Dismiss / unmount) or a
   completely external one (the user closes the tab mid-run).
   ========================================================================== */

import { pickResponderIndex } from "@/components/floor3d/retro/scene/packet-shared";
import type { HermesActions } from "@/lib/store";
import type { AgentSeat, Campaign, HermesState } from "@/lib/types";

/** Must match store.ts's STORAGE_KEY exactly — read/write only, never edited here. */
const STORAGE_KEY = "hermes-sourcing:v1";
/** Session-only flag: "the user clicked Restart, relaunch after the reload." */
const RESTART_FLAG_KEY = "hermes-sourcing:aria-live-restart";

export const ARIA_LIVE_CHAPTERS = [
  "sourcing",
  "drafting",
  "approving",
  "replying",
  "booking",
  "reporting",
  "done",
] as const;
export type AriaLiveChapter = (typeof ARIA_LIVE_CHAPTERS)[number];

export interface AriaLiveKpis {
  sourced: number;
  drafted: number;
  approved: number;
  replies: number;
  booked: number;
}

const ZERO_KPIS: AriaLiveKpis = { sourced: 0, drafted: 0, approved: 0, replies: 0, booked: 0 };

export interface AriaLiveSnapshot {
  active: boolean;
  chapter: AriaLiveChapter;
  chapterIndex: number; // 0-based
  chapterCount: number;
  caption: string;
  candidateName: string | null;
  kpis: AriaLiveKpis;
  error: string | null;
  /** True once the run has reached a terminal state (done, or failed) — the
   *  overlay shows the result card and stops auto-advancing. */
  finished: boolean;
}

const INACTIVE_SNAPSHOT: AriaLiveSnapshot = {
  active: false,
  chapter: "sourcing",
  chapterIndex: 0,
  chapterCount: ARIA_LIVE_CHAPTERS.length,
  caption: "",
  candidateName: null,
  kpis: ZERO_KPIS,
  error: null,
  finished: false,
};

/** Who the 3D director-camera hook (RetroOfficeScene.tsx) should track.
 *  `null` = director fully inactive, camera behaves exactly as before Aria
 *  Live existed. `{ establishing: true }` = a deliberate wide/overview shot
 *  (no single robot is "acting" this instant). `{ seatId }` = track that
 *  robot's live position. */
export type DirectorTarget = { seatId: string } | { establishing: true } | null;

/* ----------------------------------------------------------------------
   Tiny module-level pub/sub — same shape as agent-events.ts's emit/subscribe,
   reused here so both the overlay and the 3D scene can read live values
   without any shared React context (there is none available to us: TopBar
   and CommandSearch are siblings, and providers.tsx is out of scope).
   ------------------------------------------------------------------- */
function createChannel<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((fn) => {
        try {
          fn(next);
        } catch {
          /* a misbehaving subscriber must never break the run */
        }
      });
    },
    subscribe(fn: (v: T) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const snapshotChannel = createChannel<AriaLiveSnapshot>(INACTIVE_SNAPSHOT);
const directorChannel = createChannel<DirectorTarget>(null);

export function subscribeAriaLive(fn: (s: AriaLiveSnapshot) => void): () => void {
  return snapshotChannel.subscribe(fn);
}
export function getAriaLiveSnapshot(): AriaLiveSnapshot {
  return snapshotChannel.get();
}
export function subscribeDirectorTarget(fn: (t: DirectorTarget) => void): () => void {
  return directorChannel.subscribe(fn);
}
export function getDirectorTarget(): DirectorTarget {
  return directorChannel.get();
}

/* ----------------------------------------------------------------------
   Snapshot / restore
   ------------------------------------------------------------------- */
let preRunRaw: string | null = null;
/** Guards both "stop advancing the choreography" and "only restore once". */
let restoring = false;
let beforeUnloadHandler: (() => void) | null = null;

function safeSetItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / private mode — best effort, matches store.ts's own persistence */
  }
}

/** Writes the pre-run snapshot back and forces a real reload — the only way
 *  to make HermesProvider re-hydrate (see the file banner above). Idempotent:
 *  safe to call from Skip, Dismiss, and an unmount cleanup without risking a
 *  double-reload. */
function triggerRestore() {
  if (restoring) return;
  restoring = true;
  if (preRunRaw !== null) safeSetItem(STORAGE_KEY, preRunRaw);
  directorChannel.set(null);
  if (typeof window !== "undefined") window.location.reload();
}

/** Best-effort safety net for an abrupt real navigation (tab close, address
 *  bar navigation) that happens mid-run without Skip/Dismiss ever firing.
 *  Registered once a run starts, so it is always added AFTER HermesProvider's
 *  own beforeunload listener — browsers dispatch same-event listeners in
 *  registration order, so this one's write is always the last one standing. */
function armBeforeUnloadGuard() {
  if (beforeUnloadHandler || typeof window === "undefined") return;
  beforeUnloadHandler = () => {
    if (preRunRaw !== null) safeSetItem(STORAGE_KEY, preRunRaw);
  };
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

/* ----------------------------------------------------------------------
   Choreography
   ------------------------------------------------------------------- */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic, unambiguously-positive seeded reply — trips classifyReply's
 *  "interested" lexicon so the cinematic reliably proceeds to booking
 *  regardless of which language/provider is configured for classification. */
const SEEDED_REPLY_TEXT =
  "Hi! Thanks so much for reaching out — this sounds like a great opportunity and I'm very interested. Would love to find time for a quick call this week.";

function publish(patch: Partial<AriaLiveSnapshot>) {
  snapshotChannel.set({ ...snapshotChannel.get(), active: true, ...patch });
}

async function runSequence(actions: HermesActions, campaign: Campaign, seats: AgentSeat[]) {
  const kpis: AriaLiveKpis = { ...ZERO_KPIS };
  const chapterAt = (chapter: AriaLiveChapter) => ARIA_LIVE_CHAPTERS.indexOf(chapter);
  // Index 0 is the CEO by convention (src/lib/floor3d.ts) — everyone else is
  // an "employee" robot eligible to be the acting seat for a given event,
  // exactly like the floor page's own 2D/3D reaction (packet-shared.ts).
  const employees = seats.length > 1 ? seats.slice(1) : seats;

  const setChapter = (chapter: AriaLiveChapter, caption: string, candidateName?: string | null) => {
    publish({
      chapter,
      chapterIndex: chapterAt(chapter),
      caption,
      candidateName: candidateName ?? snapshotChannel.get().candidateName,
      kpis: { ...kpis },
      finished: chapter === "done",
    });
  };

  const fail = (caption: string) => {
    publish({ caption, error: caption, finished: true, kpis: { ...kpis } });
  };

  directorChannel.set({ establishing: true });
  setChapter("sourcing", "Scanning the Talent Pool for a match…");
  await sleep(900);
  if (restoring) return;

  const sourceRes = await actions.sourceNextBatch(campaign.id, { platform: "Talent Pool", count: 2 });
  if (restoring) return;
  if (!sourceRes.ok || sourceRes.accepted.length === 0) {
    fail(
      !sourceRes.ok
        ? `Aria couldn't source a candidate: ${sourceRes.error}`
        : "Aria couldn't source a candidate for this run — try again in a moment.",
    );
    return;
  }
  const candidate = sourceRes.accepted[0];
  kpis.sourced = 1;
  setChapter("sourcing", `Found ${candidate.name} — ${candidate.currentTitle} at ${candidate.currentCompany}.`, candidate.name);
  await sleep(1600);
  if (restoring) return;

  // Same deterministic responder-selection the floor already uses (see
  // packet-shared.ts) so the camera tracks whichever robot the floor's own
  // 2D ticker / packet FX also lights up as "working" for this event.
  const actingSeat = employees.length
    ? employees[pickResponderIndex({ kind: "allocate", campaignId: campaign.id, candidateName: candidate.name, at: Date.now() }, employees.length)]
    : undefined;
  if (actingSeat) directorChannel.set({ seatId: actingSeat.id });

  setChapter("drafting", `${actingSeat?.name ?? "Aria"} is drafting outreach for ${candidate.name}…`, candidate.name);
  await sleep(500);
  const msg = actions.generateOutreachFor(candidate.id, undefined, "Email", actingSeat?.id);
  if (restoring) return;
  if (!msg) {
    fail(`Couldn't draft outreach for ${candidate.name}.`);
    return;
  }
  kpis.drafted = 1;
  setChapter("drafting", `Draft ready: "${msg.subject}"`, candidate.name);
  await sleep(1600);
  if (restoring) return;

  setChapter("approving", `Approving the draft for ${candidate.name}…`, candidate.name);
  await sleep(500);
  const approval = actions.approveOutreach(msg.id);
  if (restoring) return;
  if (!approval.allowed) {
    fail(`Approval blocked: ${approval.blockers[0] ?? "a guardrail was hit"}.`);
    return;
  }
  kpis.approved = 1;
  setChapter("approving", "Outreach approved — scheduled (dry-run, nothing sent).", candidate.name);
  await sleep(1400);
  if (restoring) return;

  setChapter("replying", `${candidate.name} is replying…`, candidate.name);
  await sleep(800);
  const { classification } = await actions.classifyAndStoreReply({
    text: SEEDED_REPLY_TEXT,
    candidateId: candidate.id,
    campaignId: campaign.id,
  });
  if (restoring) return;
  kpis.replies = 1;
  setChapter("replying", `Reply classified as ${classification.intent.replace(/_/g, " ")}.`, candidate.name);
  await sleep(1400);
  if (restoring) return;

  setChapter("booking", `Booking an interview for ${candidate.name}…`, candidate.name);
  await sleep(500);
  const bookingRes = await actions.createBookingFor(candidate.id, {});
  if (restoring) return;
  if (!bookingRes.ok) {
    fail(`Couldn't book an interview: ${bookingRes.error}`);
    return;
  }
  kpis.booked = 1;
  setChapter("booking", `Interview booked with ${bookingRes.booking.interviewer}.`, candidate.name);
  await sleep(1600);
  if (restoring) return;

  directorChannel.set({ establishing: true });
  setChapter("reporting", "Generating the weekly report…", candidate.name);
  await sleep(700);
  actions.generateReport(campaign.id);
  if (restoring) return;
  setChapter("done", `Hire funnel complete for ${candidate.name} — report ready.`, candidate.name);
}

/** Starts a run. No-op (returns false) if one is already active — callers
 *  (TopBar, CommandSearch) should treat that as "already playing". */
export function startAriaLive(
  actions: HermesActions,
  state: HermesState,
  campaign: Campaign,
  seats: AgentSeat[],
): boolean {
  if (snapshotChannel.get().active) return false;
  restoring = false;
  preRunRaw = JSON.stringify(state);
  armBeforeUnloadGuard();
  snapshotChannel.set({ ...INACTIVE_SNAPSHOT, active: true, caption: "Starting Aria Live…" });
  void runSequence(actions, campaign, seats).catch((err) => {
    publish({
      finished: true,
      error: err instanceof Error ? err.message : "Aria Live stopped unexpectedly.",
    });
  });
  return true;
}

/** Convenience wrapper used by both trigger surfaces — resolves which
 *  campaign to run against and validates preconditions in one place so
 *  TopBar and CommandSearch can't drift out of sync. */
export function beginAriaLiveRun(opts: {
  actions: HermesActions;
  state: HermesState | null;
  campaigns: Campaign[];
  activeCampaignId: string | null;
  seats: AgentSeat[];
}): { ok: true } | { ok: false; reason: string } {
  if (!opts.state) return { ok: false, reason: "Still loading the workspace…" };
  if (getAriaLiveSnapshot().active) return { ok: false, reason: "Aria Live is already running." };
  const campaign = opts.campaigns.find((c) => c.id === opts.activeCampaignId) ?? opts.campaigns[0];
  if (!campaign) return { ok: false, reason: "Create a campaign first — Aria Live needs one to run against." };
  startAriaLive(opts.actions, opts.state, campaign, opts.seats);
  return { ok: true };
}

/** Jump to the end right now and restore — used by the overlay's Skip
 *  control. Any in-flight action is left to resolve in the background; its
 *  effect is discarded along with everything else once the restore lands. */
export function skipAriaLive(): void {
  triggerRestore();
}

/** Restore after a normal finish (result card dismissed) or a failure. */
export function dismissAriaLive(): void {
  triggerRestore();
}

/** Safety net for the overlay's unmount cleanup (e.g. AppShell doesn't
 *  render TopBar on /login or /careers — app-shell.tsx — so navigating there
 *  mid-run genuinely unmounts the overlay). No-ops if a run was never
 *  active or has already been restored. */
export function abandonAriaLiveIfActive(): void {
  if (snapshotChannel.get().active) triggerRestore();
}

/** Restart = restore now, and ask the next fresh mount to relaunch. Stored
 *  in sessionStorage (never the persisted STORAGE_KEY) purely as a one-shot
 *  flag surviving the reload this restore requires. */
export function restartAriaLive(): void {
  try {
    window.sessionStorage.setItem(RESTART_FLAG_KEY, "1");
  } catch {
    /* best effort — worst case Restart behaves like Dismiss */
  }
  triggerRestore();
}

/** Call once on mount (see aria-live-overlay.tsx). Returns true exactly once
 *  per Restart click, then clears the flag. */
export function consumeAriaLiveRestartFlag(): boolean {
  try {
    if (window.sessionStorage.getItem(RESTART_FLAG_KEY)) {
      window.sessionStorage.removeItem(RESTART_FLAG_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
