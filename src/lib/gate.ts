/* ============================================================================
   HUMAN-LIKENESS GATE — the last wall between an agent and a candidate.

   Every outbound message (Email / LinkedIn / WhatsApp / SMS) passes through
   gateOutbound() before it may enter the send queue. The gate:

     1. Runs humanize() (soft transforms: AI-isms → plain phrasing).
     2. Hard-blocks anything that still reads as machine output — status
        narration ("processing your request…"), AI self-disclosure, leaked
        tool/JSON/template artifacts, placeholder text.
     3. Produces the dedupe hash that messages_outbound enforces UNIQUE per
        workspace, so identical text can never reach the same candidate twice.
     4. Answers pacing questions (quiet hours, human-feeling send delay) so
        replies never land with robotic instant timing.

   Agent narration/status events NEVER pass through here — they live in
   agent_events, which has no send path at all. This gate exists for the
   messages that are legitimately candidate-bound.

   Deterministic by design (no Math.random / Date.now inside the checks) so
   every verdict is reproducible in tests and reviewable in gate_result.
   ========================================================================== */

import { createHash } from "crypto";
import { humanize } from "./humanizer";

export interface GatePass {
  pass: true;
  /** Final text after soft transforms — this is what may be sent. */
  text: string;
  /** Which soft transforms fired (from humanize). */
  transformed: string[];
}

export interface GateBlock {
  pass: false;
  /** Which hard-block rules fired. Stored in messages_outbound.gate_result. */
  reasons: string[];
  /** Text after soft transforms, kept for the human review queue. */
  text: string;
}

export type GateVerdict = GatePass | GateBlock;

// ---------------------------------------------------------------------------
// Hard blocks — if any of these survive humanize(), the message is machine
// output and must not reach a candidate. Each entry: [pattern, reason-tag].
// ---------------------------------------------------------------------------
const HARD_BLOCKS: [RegExp, string][] = [
  // AI self-disclosure
  [/\bas an? (AI|artificial intelligence|language model|LLM|virtual assistant)\b/i, "ai-disclosure"],
  [/\b(I'?m|I am) (an? )?(AI|artificial intelligence|language model|LLM|bot|virtual assistant|digital assistant)\b/i, "ai-disclosure"],
  [/\bAI[- ]generated\b/i, "ai-disclosure"],
  [/\bmy (programming|training data|knowledge cutoff)\b/i, "ai-disclosure"],

  // Status / progress narration — "an action getting done" must never be a message
  [/\b(processing|analyzing|computing|calculating|generating|retrieving|fetching) (your|the|this) (request|message|reply|response|data|profile)\b/i, "status-narration"],
  [/\bplease (wait|hold on|stand by) (while|as) I\b/i, "status-narration"],
  [/\bone moment while I\b/i, "status-narration"],
  [/^\s*(thinking|processing|calculating|analyzing|working|loading|searching|typing)\s*(\.{2,}|…)?\s*$/i, "status-narration"],
  [/\b(task|action|request|operation) (has been )?(completed?|executed|performed|finished|done)\b/i, "status-narration"],
  [/\bI(?:'ve| have) (now )?(completed|finished|executed|performed) (the|your|this) (task|request|action|search)\b/i, "status-narration"],
  [/\bhere(?:'s| is) (the|your) (result|output|response|generated)\b/i, "status-narration"],

  // Leaked structure: tool calls, JSON, markdown fences, chat-role prefixes
  [/```/, "leaked-markup"],
  [/^\s*[{[][\s{[]*"/, "leaked-json"],
  [/<\/?(tool|function|thinking|antml|system|assistant|response)[\s>:_-]/i, "leaked-markup"],
  [/^\s*(system|assistant|user)\s*:/im, "leaked-role-prefix"],

  // Unfilled templates / placeholders
  [/\{\{[^}]*\}\}/, "placeholder"],
  [/\[(INSERT|PLACEHOLDER|NAME|CANDIDATE|COMPANY|ROLE|TODO|FIXME)[^\]]*\]/i, "placeholder"],
  [/<(INSERT|NAME|CANDIDATE|COMPANY|ROLE)[^>]*>/i, "placeholder"],

  // Meta about instructions / capabilities — human recruiters never say this
  [/\bbased on (the|your|my) (instructions|prompt|system message)\b/i, "meta-instructions"],
  [/\baccording to my (instructions|guidelines|programming)\b/i, "meta-instructions"],
  [/\bI (don'?t|do not) have (access to|the ability to|real[- ]time)\b/i, "meta-instructions"],
];

/** Minimum plausible candidate message. Anything shorter is a fragment leak. */
const MIN_LENGTH = 8;

/**
 * Classify a candidate-bound message. Soft transforms first (humanize), then
 * hard-block scan on the transformed text.
 */
export function gateOutbound(body: string): GateVerdict {
  const { text, removed } = humanize(body ?? "");
  const reasons: string[] = [];

  if (text.trim().length < MIN_LENGTH) reasons.push("too-short");

  for (const [re, reason] of HARD_BLOCKS) {
    if (re.test(text) && !reasons.includes(reason)) reasons.push(reason);
  }

  if (reasons.length > 0) return { pass: false, reasons, text };
  return { pass: true, text, transformed: removed };
}

// ---------------------------------------------------------------------------
// Dedupe — mirrors the UNIQUE (workspace_id, dedupe_hash) constraint on
// messages_outbound. Normalized so trivial whitespace/case changes don't
// smuggle a duplicate past the cache.
// ---------------------------------------------------------------------------
export function dedupeHash(candidateId: string, channel: string, body: string): string {
  const normalized = body.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${candidateId}\n${channel}\n${normalized}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Pacing — humans don't answer at 3:12 AM in 400ms.
// ---------------------------------------------------------------------------
export interface QuietHours {
  /** Local hour 0-23, inclusive start of the quiet window (e.g. 21). */
  start: number;
  /** Local hour 0-23, exclusive end of the quiet window (e.g. 8). */
  end: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { start: 21, end: 8 };

/** True when `date` falls inside the quiet window (window may wrap midnight). */
export function inQuietHours(date: Date, quiet: QuietHours = DEFAULT_QUIET_HOURS): boolean {
  const h = date.getHours();
  return quiet.start <= quiet.end
    ? h >= quiet.start && h < quiet.end
    : h >= quiet.start || h < quiet.end;
}

/** Earliest human-plausible send time: now + jittered delay, pushed out of quiet hours. */
export function nextSendTime(now: Date, seed: string, quiet: QuietHours = DEFAULT_QUIET_HOURS): Date {
  const at = new Date(now.getTime() + replyDelayMs(seed));
  if (!inQuietHours(at, quiet)) return at;
  // Defer to the end of the quiet window (same day or next).
  const resumed = new Date(at);
  resumed.setHours(quiet.end, 0, 0, 0);
  if (resumed <= at) resumed.setDate(resumed.getDate() + 1);
  // Re-apply a fresh jitter so unblocked messages don't all fire at HH:00:00.
  return new Date(resumed.getTime() + replyDelayMs(seed + ":resume"));
}

/**
 * Deterministic jitter in [90s, 480s] derived from a seed (e.g. the message
 * id) — feels like a person typing, is reproducible in tests, and spreads
 * concurrent replies apart.
 */
export function replyDelayMs(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  const fraction = digest.readUInt32BE(0) / 0xffffffff;
  const min = 90_000;
  const max = 480_000;
  return Math.floor(min + fraction * (max - min));
}
