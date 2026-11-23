import { withStage } from "@/lib/metrics";
import type { Activity, CampaignStatus, HermesState } from "@/lib/types";

/**
 * Facts already returned by one hire. Recording them does not call Odoo,
 * SMART, the generic API, or MCP again.
 */
export type HireStepFact = {
  action: string;
  ok: boolean;
  id?: string;
  model?: string;
  skipped?: boolean;
  /** Set when this step is the vacancy close the connector already performed. */
  vacancyClosed?: boolean;
};

export type HireErp = "odoo" | "smart" | "api" | "mcp" | "skipped";

export type HireTrail = {
  who: string;
  when: string;
  need: string;
  erp: HireErp;
  odooJobId?: string;
  odooApplicantId?: string;
  stageFrom: string;
  stageTo: string;
  /** Present only when the Odoo response already says whether the stage write ran. */
  odooStage?: "written" | "not written";
  vacancyClosed: boolean;
};

export type HireTrailRow = { label: string; value: string };

const CLOSE_ACTIONS = new Set(["close", "vacancy"]);

function firstOkId(steps: readonly HireStepFact[], action: string): string | undefined {
  for (const step of steps) {
    if (step.ok && !step.skipped && step.action === action && step.id) return step.id;
  }
  return undefined;
}

function stepClosesVacancy(step: HireStepFact): boolean {
  if (!step.ok || step.skipped) return false;
  if (step.vacancyClosed === true || CLOSE_ACTIONS.has(step.action)) return true;
  // The Odoo hire step writes hr.job closed. Other connectors hire the applicant.
  return step.action === "hire" && step.model === "hr.job";
}

/** Vacancy close is taken from the hire response, never from a follow-up read. */
export function vacancyClosedFromSteps(
  steps: readonly HireStepFact[],
  explicit?: boolean,
): boolean {
  return explicit === true || steps.some(stepClosesVacancy);
}

export function buildHireTrail(input: {
  who: string;
  when: string;
  need: string;
  erp: HireErp;
  stageFrom: string;
  stageTo: string;
  steps: readonly HireStepFact[];
  vacancyClosed?: boolean;
}): HireTrail {
  const who = input.who.trim() || "Operator";
  const need = input.need.trim() || "Open role";
  const odooJobId = input.erp === "odoo" ? firstOkId(input.steps, "job") : undefined;
  const odooApplicantId = input.erp === "odoo" ? firstOkId(input.steps, "applicant") : undefined;
  const stageStep = input.steps.find((step) => step.action === "stage");
  const odooStage =
    input.erp === "odoo" && stageStep
      ? stageStep.ok && !stageStep.skipped
        ? "written"
        : "not written"
      : undefined;
  return {
    who,
    when: input.when,
    need,
    erp: input.erp,
    odooJobId,
    odooApplicantId,
    stageFrom: input.stageFrom,
    stageTo: input.stageTo,
    odooStage,
    vacancyClosed: vacancyClosedFromSteps(input.steps, input.vacancyClosed),
  };
}

/** Stable lines the drawer and the activity notes both show. */
export function hireTrailRows(trail: HireTrail): HireTrailRow[] {
  const rows: HireTrailRow[] = [
    { label: "Who", value: trail.who },
    { label: "When", value: trail.when },
    { label: "Need", value: trail.need },
  ];
  if (trail.odooJobId) rows.push({ label: "Odoo job", value: trail.odooJobId });
  if (trail.odooApplicantId) rows.push({ label: "Odoo applicant", value: trail.odooApplicantId });
  rows.push({ label: "Stage", value: `${trail.stageFrom} → ${trail.stageTo}` });
  if (trail.odooStage) rows.push({ label: "Odoo stage", value: trail.odooStage });
  rows.push({ label: "Vacancy", value: trail.vacancyClosed ? "closed" : "open" });
  return rows;
}

export function hireTrailNotes(trail: HireTrail): string {
  return hireTrailRows(trail).map((row) => `${row.label}: ${row.value}`).join("\n");
}

export function hireTrailTitle(candidateName: string): string {
  const name = candidateName.trim() || "Candidate";
  return `Hired: ${name}`;
}

/**
 * One workspace write: stage, recent activity, campaign trail, and vacancy
 * status when the connector already closed it. A repeated trail is a no-op.
 */
export function applyHireTrail(
  state: HermesState,
  input: { candidateId: string; trail: HireTrail; activityId: string },
): HermesState {
  const candidate = state.candidates.find((item) => item.id === input.candidateId);
  if (!candidate) return state;
  const title = hireTrailTitle(candidate.name);
  const notes = hireTrailNotes(input.trail);
  const duplicate = state.activities.some(
    (activity) =>
      activity.linkedEntityType === "candidate" &&
      activity.linkedEntityId === input.candidateId &&
      activity.title === title &&
      activity.notes === notes,
  );
  if (duplicate) return state;

  const activity: Activity = {
    id: input.activityId,
    type: "system",
    title,
    notes,
    outcome: input.trail.vacancyClosed ? "Hired, vacancy closed" : "Hired",
    campaignId: candidate.campaignId,
    linkedEntityType: "candidate",
    linkedEntityId: input.candidateId,
    createdAt: input.trail.when,
  };
  const recentActivity = `Hired by ${input.trail.who} for ${input.trail.need}.`;
  const candidates = state.candidates.map((item) =>
    item.id === input.candidateId
      ? { ...item, ...withStage(item, "Hired"), recentActivity }
      : item,
  );
  const campaigns = state.campaigns.map((campaign) => {
    if (campaign.id !== candidate.campaignId) return campaign;
    const status: CampaignStatus = input.trail.vacancyClosed ? "Filled" : campaign.status;
    return {
      ...campaign,
      status,
      activities: [activity, ...campaign.activities].slice(0, 80),
    };
  });
  return {
    ...state,
    candidates,
    campaigns,
    activities: [activity, ...state.activities].slice(0, 300),
  };
}
