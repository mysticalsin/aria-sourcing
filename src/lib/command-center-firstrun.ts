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
 * otherwise start a new campaign. First-run always points at the new-campaign flow.
 */
export function resolveCommandCenterNextStep(snapshot: CommandCenterSnapshot): CommandCenterNextStep {
  if (isFirstRunWorkspace(snapshot)) {
    return {
      cta: "Paste a job brief",
      reason: "Aria will find people and draft messages — you approve before anything sends.",
      href: "/campaigns/new",
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
 * Plain statement of how candidates and LinkedIn are handled. Settings,
 * the channel catalog, and the token panel keep their own copy.
 */
export const LINKEDIN_BOUNDARY =
  "Aria does not automate or scrape LinkedIn. Candidates come from sanctioned sources. An off-by-default token channel exists that only admins can enable. HeyReach is off by default.";

/**
 * First-run modal tour copy — plain language, no fleet/soul/ops-floor jargon.
 * An empty workspace starts from a job brief. A populated demo talks about
 * the work already waiting, so the tour does not contradict the page.
 */
export function onboardingTourFor(snapshot: CommandCenterSnapshot): readonly OnboardingTourStep[] {
  if (isFirstRunWorkspace(snapshot)) {
    return [
      {
        title: "Welcome to Aria",
        body: `Paste a job brief. ${LINKEDIN_BOUNDARY} You approve every send.`,
      },
      {
        title: "You stay in control",
        body: "Every message starts as a draft. Nothing sends until you approve it. Email stays a dry-run.",
      },
      {
        title: "Start with one job",
        body: "That’s it. Click New campaign, paste a brief, and Aria takes the first step. For a guided walkthrough of every page, open Tutorial in the menu.",
      },
    ];
  }

  const pending = snapshot.pendingApprovalCount ?? 0;
  const waiting =
    pending === 1
      ? "1 message is waiting for your approval."
      : pending > 0
        ? `${pending} messages are waiting for your approval.`
        : "Campaigns are already in motion.";
  return [
    {
      title: "Welcome to Aria",
      body: `This demo already has campaigns in motion. ${waiting} ${LINKEDIN_BOUNDARY}`,
    },
    {
      title: "You stay in control",
      body: "Every message starts as a draft. Nothing sends until you approve it. Email stays a dry-run.",
    },
    {
      title: "Review the queue",
      body: "Open Outreach to work through the waiting messages. For a guided walkthrough of every page, open Tutorial in the menu.",
    },
  ];
}

/** Empty-workspace tour. Populated workspaces use onboardingTourFor. */
export const ONBOARDING_TOUR_STEPS: readonly OnboardingTourStep[] = onboardingTourFor({ campaignCount: 0 });
