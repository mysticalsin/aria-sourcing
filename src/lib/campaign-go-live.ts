/**
 * Campaign "Go live" checklist — readiness before LinkedIn Send.
 */

import type { AgentSeat, Candidate, SystemSettings } from "@/lib/types";

export type GoLiveCheckId =
  | "dry_run_off"
  | "browser_seat_attached"
  | "seat_live"
  | "seat_not_human_held"
  | "session_healthy"
  | "candidate_above_floor";

export type GoLiveCheck = {
  id: GoLiveCheckId;
  label: string;
  ok: boolean;
  detail: string;
  ctaLabel?: string;
  ctaHref?: string;
};

export type ComputerHealthLike = {
  computerId: string;
  seatId?: string | null;
  status?: string;
  control?: string;
  sessionHealthy?: boolean | null;
};

export type GoLiveInput = {
  campaignId: string;
  settings: Pick<SystemSettings, "dryRunMode" | "minScoreToContact">;
  seats: AgentSeat[];
  computers?: ComputerHealthLike[];
  candidate?: Pick<Candidate, "matchScore"> | null;
};

function isBrowserComputerSeat(seat: AgentSeat): boolean {
  return (
    seat.provider === "LinkedIn Browser Computer" ||
    seat.linkedinDeliveryBackend === "browser-computer" ||
    Boolean(seat.computerId)
  );
}

export function campaignBrowserSeats(seats: AgentSeat[], campaignId: string): AgentSeat[] {
  return seats.filter((s) => {
    if (!isBrowserComputerSeat(s)) return false;
    const assigned = s.assignedCampaignIds ?? [];
    return assigned.length === 0 || assigned.includes(campaignId);
  });
}

export function evaluateCampaignGoLive(input: GoLiveInput): {
  ready: boolean;
  checks: GoLiveCheck[];
  nextAction?: GoLiveCheck;
} {
  const attached = campaignBrowserSeats(input.seats, input.campaignId);
  const primary = attached.find((s) => s.status === "active") ?? attached[0];
  const computer =
    input.computers?.find((c) => primary?.computerId && c.computerId === primary.computerId) ??
    input.computers?.find((c) => primary && c.seatId === primary.id) ??
    input.computers?.[0];

  const humanHeld = computer?.control === "human";
  const needsHelp = computer?.status === "help_requested" || computer?.status === "error";
  // Never invent healthy from ready+bot — only Release /session-probe sets true.
  const sessionHealthy = computer?.sessionHealthy === true;

  const floor = input.settings.minScoreToContact ?? 80;
  const scoreOk =
    !input.candidate ||
    (typeof input.candidate.matchScore === "number" && input.candidate.matchScore >= floor);

  const checks: GoLiveCheck[] = [
    {
      id: "dry_run_off",
      label: "Dry-run off",
      ok: !input.settings.dryRunMode,
      detail: input.settings.dryRunMode
        ? "Dry-run is on — approvals rehearse only; nothing contacts candidates."
        : "Live contact allowed.",
      ctaLabel: "Open Approval & Compliance",
      ctaHref: "/settings?tab=compliance",
    },
    {
      id: "browser_seat_attached",
      label: "Browser Computer attached",
      ok: attached.length > 0,
      detail:
        attached.length > 0
          ? `${attached.length} LinkedIn Browser Computer seat(s) on this campaign.`
          : "Attach a LinkedIn Browser Computer seat on the Agents tab.",
      ctaLabel: "Open Agents",
      ctaHref: `/campaigns/${input.campaignId}?tab=agents`,
    },
    {
      id: "seat_live",
      label: "Seat live + active",
      ok: Boolean(primary && primary.status === "active" && primary.mode === "live"),
      detail: !primary
        ? "No browser seat yet."
        : primary.mode !== "live"
          ? "Seat is still in mock mode — set it live in Fleet / Settings."
          : primary.status !== "active"
            ? `Seat status is ${primary.status}.`
            : "Seat is live and active.",
      ctaLabel: "Open Fleet",
      ctaHref: "/fleet",
    },
    {
      id: "seat_not_human_held",
      label: "Not held by human",
      ok: attached.length > 0 && !humanHeld,
      detail: humanHeld
        ? "You still have Take control — Release so the bot can send."
        : "Mutex clear for bot sends.",
      ctaLabel: "Open Agents",
      ctaHref: `/campaigns/${input.campaignId}?tab=agents`,
    },
    {
      id: "session_healthy",
      label: "LinkedIn session healthy",
      ok: attached.length > 0 && sessionHealthy,
      detail: !computer
        ? "No computer status yet — Start the agent, then Take control to log in."
        : needsHelp
          ? "Computer needs help (login / checkpoint). Take control, finish LinkedIn login, Release."
          : sessionHealthy
            ? "Session looks ready."
            : "Session not confirmed — Take control and open linkedin.com once.",
      ctaLabel: "Take control",
      ctaHref: `/campaigns/${input.campaignId}?tab=agents`,
    },
    {
      id: "candidate_above_floor",
      label: `Score ≥ ${floor}`,
      ok: scoreOk,
      detail: !input.candidate
        ? `Contact floor is ${floor} (checked per candidate at send).`
        : scoreOk
          ? `Candidate score ${input.candidate.matchScore} clears the floor.`
          : `Candidate score ${input.candidate.matchScore} is below the contact floor (${floor}).`,
    },
  ];

  const nextAction = checks.find((c) => !c.ok);
  return { ready: checks.every((c) => c.ok), checks, nextAction };
}
