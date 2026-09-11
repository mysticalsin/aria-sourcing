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
  // Provider/backend only — a bare computerId must not classify email seats as Browser Computers.
  return (
    seat.provider === "LinkedIn Browser Computer" ||
    seat.linkedinDeliveryBackend === "browser-computer"
  );
}

export function campaignBrowserSeats(seats: AgentSeat[], campaignId: string): AgentSeat[] {
  return seats.filter((s) => {
    if (!isBrowserComputerSeat(s)) return false;
    // Explicit campaign membership only — unassigned seats are not "attached".
    return (s.assignedCampaignIds ?? []).includes(campaignId);
  });
}

function computerForSeat(
  computers: ComputerHealthLike[] | undefined,
  seat: AgentSeat,
): ComputerHealthLike | undefined {
  if (!computers?.length) return undefined;
  // Seat ownership first (same rule as resolveComputerHint) — a stale Hermes
  // computerId must not pull another seat's / orphan VM into this desk's go-live.
  const bySeat = computers.find((c) => c.seatId === seat.id);
  if (bySeat) return bySeat;
  const computerId = typeof seat.computerId === "string" ? seat.computerId.trim() : "";
  if (!computerId) return undefined;
  const byComputer = computers.find((c) => c.computerId === computerId);
  if (!byComputer) return undefined;
  if (byComputer.seatId && byComputer.seatId !== seat.id) return undefined;
  return byComputer;
}

export function evaluateCampaignGoLive(input: GoLiveInput): {
  ready: boolean;
  checks: GoLiveCheck[];
  nextAction?: GoLiveCheck;
} {
  const attached = campaignBrowserSeats(input.seats, input.campaignId);
  const liveActive = attached.filter((s) => s.status === "active" && s.mode === "live");
  const comps = attached.map((s) => ({ seat: s, computer: computerForSeat(input.computers, s) }));
  const humanHeld = comps.some((x) => x.computer?.control === "human");
  const needsHelp = comps.some(
    (x) => x.computer?.status === "help_requested" || x.computer?.status === "error",
  );
  // Never invent healthy from ready+bot — only Release /session-probe sets true.
  // Every attached seat must have its own probed-healthy computer (no computers[0] fallback).
  const allHealthy =
    attached.length > 0 && comps.every((x) => x.computer?.sessionHealthy === true);
  const missingComputer = comps.some((x) => !x.computer);
  const healthyCount = comps.filter((x) => x.computer?.sessionHealthy === true).length;

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
          ? `${attached.length} LinkedIn Browser Computer seat(s) assigned to this campaign.`
          : "Assign a LinkedIn Browser Computer seat on the Agents tab (explicit attach).",
      ctaLabel: "Open Agents",
      ctaHref: `/campaigns/${input.campaignId}?tab=agents`,
    },
    {
      id: "seat_live",
      label: "Seat live + active",
      ok: attached.length > 0 && liveActive.length === attached.length,
      detail:
        attached.length === 0
          ? "No browser seat yet."
          : liveActive.length < attached.length
            ? `${liveActive.length}/${attached.length} attached seats are live+active — fix the rest in Fleet.`
            : `${attached.length} seat(s) live and active.`,
      ctaLabel: "Open Fleet",
      ctaHref: "/fleet",
    },
    {
      id: "seat_not_human_held",
      label: "Not held by human",
      ok: attached.length > 0 && !humanHeld,
      detail: humanHeld
        ? "A seat still has Take control — Release so the bot can send."
        : "Mutex clear for bot sends.",
      ctaLabel: "Open Agents",
      ctaHref: `/campaigns/${input.campaignId}?tab=agents`,
    },
    {
      id: "session_healthy",
      label: "LinkedIn session healthy",
      ok: allHealthy,
      detail: missingComputer
        ? "Missing computer status for an attached seat — Start the agent, then Take control to log in."
        : needsHelp
          ? "A computer needs help (login / checkpoint). Take control, finish LinkedIn login, Release."
          : allHealthy
            ? `${healthyCount}/${attached.length} sessions probed healthy.`
            : `${healthyCount}/${attached.length} sessions healthy — Take control on each unverified seat.`,
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
