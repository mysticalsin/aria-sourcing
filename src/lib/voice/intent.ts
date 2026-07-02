/* ============================================================================
   Voice intent resolution — turns a recognized (or typed-fallback)
   transcript into an AriaPlan by calling the SAME deterministic grammar the
   Aria Command console uses (src/lib/aria-command.ts). Pure and side-effect
   free: no store import, no network, no randomness — mirrors
   aria-command.ts's own contract so voice and the ⌘K console can never
   drift apart or parse the same sentence two different ways.
   ========================================================================== */

import { campaignToAriaContext, parseCommand, type AriaPlan, type AriaVerb } from "@/lib/aria-command";
import type { Campaign } from "@/lib/types";

export interface VoiceIntent {
  /** The parsed, previewable plan — identical shape to Aria Command's. */
  plan: AriaPlan;
  /** False when parseCommand recognized no verb at all. voice-console.tsx
   *  must treat this as "didn't catch an actionable command" and never
   *  dispatch runAriaPlan — the same empty-plan contract parseCommand
   *  already guarantees, named here so callers don't have to know the
   *  underlying shape (`plan.steps.length === 0`). */
  actionable: boolean;
  /** One-line human summary, straight from the plan. */
  summary: string;
}

/** Parses a transcript against the live campaign list. Never throws —
 *  delegates entirely to parseCommand's own no-throw contract; a missing or
 *  malformed campaigns array degrades to "no campaign matched" rather than
 *  crashing the voice console. */
export function resolveVoiceIntent(transcript: string, campaigns: Campaign[]): VoiceIntent {
  const ctx = { campaigns: (Array.isArray(campaigns) ? campaigns : []).map(campaignToAriaContext) };
  const plan = parseCommand(transcript, ctx);
  return { plan, actionable: plan.steps.length > 0, summary: plan.summary };
}

/** Nav destination to flash once a plan finishes running — the "downstream"
 *  screen where its effects actually show up. Keyed off the LAST step
 *  (aria-command.ts always sorts `plan.steps` to a fixed VERB_ORDER, so the
 *  last step is the sequence's ultimate outcome — e.g. "source ... and draft
 *  outreach" ends on Outreach, not Campaigns). */
const VERB_NAV_HREF: Record<AriaVerb, string> = {
  source: "/campaigns",
  draft: "/outreach",
  "follow-up": "/outreach",
  book: "/calendar",
  pool: "/vivier",
  report: "/reports",
};

/** Returns the nav href to flash for a (non-empty) plan, or undefined for an
 *  empty/unactionable one — callers should skip the flash entirely in that
 *  case rather than flashing an arbitrary default. */
export function navHrefForPlan(plan: AriaPlan): string | undefined {
  const last = plan.steps[plan.steps.length - 1];
  return last ? VERB_NAV_HREF[last.verb] : undefined;
}
