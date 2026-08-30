/**
 * Command Center first-run vs returning-user helpers.
 *
 * Pure + side-effect free: no store, no DOM, no network. Drives the home `/`
 * surface so a brand-new workspace answers "what do I do next?" in ~10 seconds
 * without enterprise jargon (fleet, soul, operations floor, etc.).
 */

export type CommandCenterMode = "first_run" | "returning";

export type CommandCenterNextStep = {
  /** Short imperative label for the primary CTA. */
  cta: string;
  /** One-line reason the user should do this now. */
  reason: string;
  /** In-app path for the CTA. */
  href: string;
};

export type CommandCenterSnapshot = {
  campaignCount: number;
  activeCampaignTitle?: string | null;
  /** Outreach drafts waiting on human approval. */
  pendingApprovalCount?: number;
  /** Unread / unreplied inbound replies. */
  unrepliedCount?: number;
};

/** True when the workspace has never launched a campaign. */
export function isFirstRunWorkspace(snapshot: Pick<CommandCenterSnapshot, "campaignCount">): boolean {
  return (snapshot.campaignCount ?? 0) <= 0;
}

export function commandCenterMode(snapshot: Pick<CommandCenterSnapshot, "campaignCount">): CommandCenterMode {
  return isFirstRunWorkspace(snapshot) ? "first_run" : "returning";
}

/**
 * Single next action for the Command Center command bar / hero.
 * Priority: approve drafts → handle replies → keep sourcing active campaign →
 * otherwise start an intake. First-run always points at intake.
 */
export function resolveCommandCenterNextStep(snapshot: CommandCenterSnapshot): CommandCenterNextStep {
  if (isFirstRunWorkspace(snapshot)) {
    return {
      cta: "Paste a job brief",
      reason: "Aria will find people and draft messages — you approve before anything sends.",
      href: "/intake",
    };
  }

  const pending = snapshot.pendingApprovalCount ?? 0;
  if (pending > 0) {
    return {
      cta: "Review outreach",
      reason:
        pending === 1
          ? "1 message is waiting for your approval."
          : `${pending} messages are waiting for your approval.`,
      href: "/outreach",
    };
  }

  const unreplied = snapshot.unrepliedCount ?? 0;
  if (unreplied > 0) {
    return {
      cta: "Check replies",
      reason:
        unreplied === 1
          ? "Someone replied — decide the next step."
          : `${unreplied} replies need a decision.`,
      href: "/replies",
    };
  }

  const title = snapshot.activeCampaignTitle?.trim();
  if (title) {
    return {
      cta: "Keep sourcing",
      reason: `Acting on ${title}`,
      href: "/campaigns",
    };
  }

  return {
    cta: "Open campaigns",
    reason: "Pick a campaign to source, draft, or report on.",
    href: "/campaigns",
  };
}

export type FirstRunGuideStep = {
  id: "brief" | "people" | "approve";
  title: string;
  body: string;
};

/** Three consumer-grade steps shown on an empty Command Center. */
export const FIRST_RUN_GUIDE_STEPS: readonly FirstRunGuideStep[] = [
  {
    id: "brief",
    title: "Paste a job",
    body: "Drop in a hiring brief or JD. Aria reads it and opens a campaign.",
  },
  {
    id: "people",
    title: "Review people",
    body: "Aria finds matched candidates. You shortlist who looks right.",
  },
  {
    id: "approve",
    title: "Approve messages",
    body: "Outreach stays in draft until you say yes. Nothing sends without you.",
  },
] as const;

export type OnboardingTourStep = {
  title: string;
  body: string;
};

/**
 * First-run modal tour copy — plain language, no fleet/soul/ops-floor jargon.
 * Kept here so unit tests lock the consumer tone.
 */
export const ONBOARDING_TOUR_STEPS: readonly OnboardingTourStep[] = [
  {
    title: "Welcome to Aria",
    body: "Paste a job brief. Aria finds people, drafts outreach, and books interviews — you approve every send.",
  },
  {
    title: "You stay in control",
    body: "Every message starts as a draft. Flip to live sending only when you’re ready. Dry-run is the default.",
  },
  {
    title: "Start with one job",
    body: "That’s it. Open Intake, paste a brief, and Aria takes the first step.",
  },
] as const;
