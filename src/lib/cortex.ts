import type { AgentSeat, Candidate, HermesState, MatchBreakdownItem } from "./types";
import { agentActivity, type AgentActivityState } from "./floor";
import { applyConfidentiality, hasOutreachPurpose } from "./confidential";
import {
  ledgerHasActiveContact,
  recentlyContacted,
  seatHealthStatus,
  suppressionMatch,
  warmupStage,
} from "./fleet";
import { roleProfile } from "./roles";

/* ============================================================================
   GLASS CORTEX — "what is this agent thinking right now?"
   Builds a deterministic-yet-alive reasoning trace for one seat, seeded
   entirely from REAL workspace state: agentActivity() (src/lib/floor.ts) for
   the top-level status, the seat's actual current-focus candidate (re-derived
   here with the identical selection rule floor.ts uses, so the cortex always
   narrates the SAME candidate the floor tile shows), that candidate's real
   6-dim matchBreakdown, and the real suppression/ledger/health facts that
   would actually gate a send. No Math.random anywhere — variation comes
   entirely from seat id and candidate fields, so the same seat+state always
   produces the same trace. Pure module: no React, no network, no store writes.
   ========================================================================== */

export type CortexRungKey = "source" | "score" | "draft";
export type CortexRungStatus = "done" | "active" | "skipped";

export interface CortexRung {
  key: CortexRungKey;
  label: string;
  status: CortexRungStatus;
  detail: string;
}

export type CortexChipTone = "success" | "warning" | "danger" | "neutral";

export interface CortexChip {
  key: string;
  label: string;
  tone: CortexChipTone;
  detail: string;
}

export interface CortexTrace {
  seatId: string;
  /** Mirrors agentActivity(seat, state).state — what the floor tile itself shows. */
  activityState: AgentActivityState;
  /** Mirrors agentActivity(seat, state).label — the drawer/description headline. */
  headline: string;
  candidateId: string | null;
  /** Confidentiality-masked, display-ready (never the raw PII when masking applies). */
  candidateName: string | null;
  /** True when the focus candidate is blocked from contact (suppression list,
   *  do-not-contact, or unsubscribed) — the signal that trips a chip red and
   *  skips the draft rung. */
  suppressed: boolean;
  /** The streamed reasoning log, one short "thought" per entry. */
  lines: string[];
  ladder: CortexRung[];
  chips: CortexChip[];
  /** The candidate's real 6-dim score breakdown; empty when no candidate is in focus. */
  meters: MatchBreakdownItem[];
  matchScore: number | null;
}

function hash(s: string): number {
  return s.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
}

function pick<T>(items: readonly T[], seed: number): T {
  return items[((seed % items.length) + items.length) % items.length];
}

const OPENERS = [
  "Pulling up",
  "Checking in on",
  "Reviewing the queue for",
  "Scanning",
] as const;

const CLEAR_WORDS = ["Clear.", "Nothing flagged.", "No hits.", "All clear."] as const;

/** Fixed per-dimension detail text so the same signal always reads the same way. */
function dimSummary(item: MatchBreakdownItem): string {
  return `${item.label} ${Math.round(item.score)}/100 — ${item.rationale}`;
}

function maskedName(candidate: Candidate, state: HermesState): string {
  return state.settings.confidentialityMode && !hasOutreachPurpose(candidate.stage)
    ? applyConfidentiality(candidate, { confidentialityMode: true, reveal: false }).name
    : candidate.name;
}

function healthChip(seat: AgentSeat, state: HermesState): CortexChip {
  const health = seatHealthStatus(seat, state.settings.fleet);
  return { key: "health", label: health.label, tone: health.tone === "success" ? "success" : health.tone === "warning" ? "warning" : "danger", detail: health.detail };
}

/** Builds the deterministic cortex trace for one seat. Same seat+state (at a
 *  given `now`) always yields the same trace — no randomness, only real facts. */
export function agentCortexTrace(seat: AgentSeat, state: HermesState, now = Date.now()): CortexTrace {
  const activity = agentActivity(seat, state, now);
  const h = hash(seat.id);
  const base = {
    seatId: seat.id,
    activityState: activity.state,
    headline: activity.label,
  };

  // ---- Offline: disabled by the operator -----------------------------------
  if (seat.status === "disabled") {
    return {
      ...base,
      candidateId: null,
      candidateName: null,
      suppressed: false,
      lines: [`${seat.name} is offline — disabled by the operator.`, "Nothing to reason about while offline."],
      ladder: [
        { key: "source", label: "Source", status: "skipped", detail: "Agent is offline." },
        { key: "score", label: "Score", status: "skipped", detail: "Agent is offline." },
        { key: "draft", label: "Draft", status: "skipped", detail: "Agent is offline." },
      ],
      chips: [{ key: "status", label: "Offline", tone: "neutral", detail: "Disabled — no seat activity to guard." }],
      meters: [],
      matchScore: null,
    };
  }

  // ---- Paused: manually, or auto-paused by a deliverability guardrail ------
  const health = seatHealthStatus(seat, state.settings.fleet);
  if (seat.status === "paused" || health.shouldPause) {
    const manual = seat.status === "paused";
    return {
      ...base,
      candidateId: null,
      candidateName: null,
      suppressed: false,
      lines: manual
        ? [`${seat.name} is paused — holding until the operator resumes.`, "No candidate cycle running while paused."]
        : [`Deliverability guardrail tripped: ${health.detail}`, "Holding every send until this clears."],
      ladder: [
        { key: "source", label: "Source", status: "skipped", detail: "Paused — no cycle running." },
        { key: "score", label: "Score", status: "skipped", detail: "Paused — no cycle running." },
        { key: "draft", label: "Draft", status: "skipped", detail: "Paused — nothing to draft." },
      ],
      chips: [
        { key: "status", label: manual ? "Manually paused" : "Auto-paused", tone: "danger", detail: manual ? "Paused by the operator." : health.detail },
        healthChip(seat, state),
      ],
      meters: [],
      matchScore: null,
    };
  }

  // ---- Warming up -----------------------------------------------------------
  const ws = warmupStage(seat, now);
  if (!ws.full) {
    return {
      ...base,
      candidateId: null,
      candidateName: null,
      suppressed: false,
      lines: [
        `${seat.name} is still warming up — day ${ws.day}, capped at ${ws.cap} sends/day.`,
        "Ramping deliverability before taking a full candidate load.",
      ],
      ladder: [
        { key: "source", label: "Source", status: "skipped", detail: "Warm-up ramp — full cycle resumes once warmup completes." },
        { key: "score", label: "Score", status: "skipped", detail: "Warm-up ramp." },
        { key: "draft", label: "Draft", status: "skipped", detail: "Warm-up ramp." },
      ],
      chips: [
        { key: "warmup", label: "Warming up", tone: "warning", detail: `Day ${ws.day} of ramp, cap ${ws.cap}/day.` },
        healthChip(seat, state),
      ],
      meters: [],
      matchScore: null,
    };
  }

  // ---- No active campaigns need this seat ------------------------------------
  const campaigns = state.campaigns.filter((c) => !["Filled", "Paused"].includes(c.status));
  if (campaigns.length === 0) {
    return {
      ...base,
      candidateId: null,
      candidateName: null,
      suppressed: false,
      lines: [`No active campaigns need ${seat.name} right now.`, "Standing by for the next assignment."],
      ladder: [
        { key: "source", label: "Source", status: "skipped", detail: "Standing by — nothing queued." },
        { key: "score", label: "Score", status: "skipped", detail: "Standing by." },
        { key: "draft", label: "Draft", status: "skipped", detail: "Standing by." },
      ],
      chips: [{ key: "queue", label: "Standing by", tone: "neutral", detail: "No active campaigns assigned." }],
      meters: [],
      matchScore: null,
    };
  }

  // ---- Working: replicate floor.ts's exact campaign/candidate selection so
  // the cortex always narrates the same focus candidate the floor tile shows. --
  const campaign = campaigns[h % campaigns.length];
  const cands = state.candidates.filter((c) => c.campaignId === campaign.id);
  const mode = h % 3;
  const role = roleProfile(campaign.jobAnalysis).label;
  const opener = pick(OPENERS, h);

  let focus: Candidate | undefined;
  if (mode === 0) focus = cands.find((c) => c.stage === "Sourced") ?? cands[h % Math.max(1, cands.length)];
  else if (mode === 1) focus = cands.find((c) => c.stage === "Contacted") ?? cands[h % Math.max(1, cands.length)];
  else focus = cands.find((c) => c.stage === "Interested" || c.stage === "Booked") ?? cands[0];

  if (!focus) {
    return {
      ...base,
      candidateId: null,
      candidateName: null,
      suppressed: false,
      lines: [`${opener} ${campaign.title} (${role}).`, "No candidates sourced yet for this campaign — nothing to score or draft."],
      ladder: [
        { key: "source", label: "Source", status: "active", detail: "Searching — no hits yet." },
        { key: "score", label: "Score", status: "skipped", detail: "Nothing to score yet." },
        { key: "draft", label: "Draft", status: "skipped", detail: "Nothing to draft yet." },
      ],
      chips: [healthChip(seat, state)],
      meters: [],
      matchScore: null,
    };
  }

  const name = maskedName(focus, state);
  const supp = suppressionMatch(state.suppression, focus, now);
  const doNotContact = focus.complianceFlags.doNotContact;
  const unsubscribed = focus.complianceFlags.unsubscribed;
  const blocked = Boolean(supp) || doNotContact || unsubscribed;
  const activeClaim = ledgerHasActiveContact(state.ledger, focus.id);
  const withinWindow = recentlyContacted(state.ledger, focus.id, state.settings.fleet.recontactWindowDays, now);
  const alreadyDrafted = focus.outreachHistory.length > 0;

  const sorted = [...focus.matchBreakdown].sort((a, b) => b.contribution - a.contribution);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  const lines: string[] = [
    `${opener} ${campaign.title} (${role}).`,
    `Candidate in focus: ${name} — ${focus.currentTitle} at ${focus.currentCompany}.`,
    `Sourced via ${focus.sourcePlatform}, matched on "${focus.sourceQuery}".`,
    `Composite score ${Math.round(focus.matchScore)}/100. Strongest signal — ${dimSummary(strongest)}`,
  ];
  if (weakest && weakest.key !== strongest.key) {
    lines.push(`Weakest signal — ${dimSummary(weakest)}`);
  }
  if (focus.replyHistory.length > 0) {
    const latest = focus.replyHistory[0];
    lines.push(`Last reply on file: ${latest.intent} (${Math.round(latest.confidence * 100)}% confidence).`);
  }
  lines.push("Checking the suppression list…");
  lines.push(
    blocked
      ? `⚠ Match found — ${supp ? `suppression list (${supp.reason || supp.type})` : doNotContact ? "do-not-contact flag" : "unsubscribed"}. Stopping before draft.`
      : pick(CLEAR_WORDS, h),
  );
  lines.push("Checking the ledger…");
  lines.push(
    activeClaim
      ? "Already claimed elsewhere — skipping duplicate contact."
      : withinWindow
        ? `Inside the ${state.settings.fleet.recontactWindowDays}-day re-contact window — holding.`
        : "No active claim on file.",
  );
  if (blocked) {
    lines.push("Draft blocked by guardrail. Moving to the next candidate.");
  } else if (alreadyDrafted || activeClaim) {
    lines.push(`Outreach already drafted for ${name} — sitting in the approval queue.`);
  } else {
    lines.push(`Drafting personalized outreach for ${name} now.`);
  }

  const ladder: CortexRung[] = [
    { key: "source", label: "Source", status: "done", detail: `Found via ${focus.sourcePlatform} — matched "${focus.sourceQuery}".` },
    {
      key: "score",
      label: "Score",
      status: "done",
      detail: `Composite ${Math.round(focus.matchScore)}/100 — strongest ${strongest.label} (${Math.round(strongest.score)}/100).`,
    },
    blocked
      ? { key: "draft", label: "Draft", status: "skipped", detail: `Blocked before drafting — ${supp ? supp.reason || supp.type : doNotContact ? "do-not-contact" : "unsubscribed"}.` }
      : alreadyDrafted || activeClaim
        ? { key: "draft", label: "Draft", status: "done", detail: alreadyDrafted ? `Drafted — "${focus.outreachHistory[0].subject}".` : "Contact already claimed." }
        : { key: "draft", label: "Draft", status: "active", detail: "Drafting personalized outreach now." },
  ];

  const chips: CortexChip[] = [
    supp
      ? { key: "suppression", label: "Suppressed", tone: "danger", detail: `On the suppression list — ${supp.reason || supp.type}.` }
      : doNotContact
        ? { key: "suppression", label: "Do-not-contact", tone: "danger", detail: "Candidate flagged do-not-contact." }
        : unsubscribed
          ? { key: "suppression", label: "Unsubscribed", tone: "danger", detail: "Candidate unsubscribed from outreach." }
          : { key: "suppression", label: "Clear to contact", tone: "success", detail: "No suppression match." },
    activeClaim
      ? { key: "ledger", label: "Already claimed", tone: "warning", detail: "An active ledger claim exists for this candidate." }
      : withinWindow
        ? { key: "ledger", label: "Re-contact window", tone: "warning", detail: `Inside the ${state.settings.fleet.recontactWindowDays}-day re-contact window.` }
        : { key: "ledger", label: "Ledger clear", tone: "success", detail: "No active claim or recent contact." },
    healthChip(seat, state),
  ];

  return {
    ...base,
    candidateId: focus.id,
    candidateName: name,
    suppressed: blocked,
    lines,
    ladder,
    chips,
    meters: focus.matchBreakdown,
    matchScore: focus.matchScore,
  };
}

/** The full script as plain text (lines joined by newline) — used for the
 *  instant, non-streamed render under prefers-reduced-motion. */
export function cortexScriptText(trace: Pick<CortexTrace, "lines">): string {
  return trace.lines.join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Streams the trace's lines word-by-word (yielding "\n" between lines) so the
 * UI can render it as it "thinks". Deterministic pacing — a word's delay is a
 * function of its own length and position, never Math.random. The consumer
 * should call `generator.return()` on cleanup (e.g. selection change/unmount)
 * to stop mid-stream; `for await...of` breaking out of the loop does this
 * automatically.
 */
export async function* streamCortexWords(
  trace: Pick<CortexTrace, "lines">,
  opts: { wordDelayMs?: number } = {},
): AsyncGenerator<string, void, unknown> {
  const base = opts.wordDelayMs ?? 55;
  for (let li = 0; li < trace.lines.length; li++) {
    const words = trace.lines[li].split(" ");
    for (let wi = 0; wi < words.length; wi++) {
      await delay(base + ((words[wi].length * 7 + wi * 3) % 40));
      yield wi < words.length - 1 ? `${words[wi]} ` : words[wi];
    }
    yield "\n";
    await delay(base * 2);
  }
}
