/**
 * Smart stages rebuilt in Odoo (build plan §15). Hired is gated: a move
 * into it is refused here so the gallery cannot pretend a hire happened.
 */

export const STAGES = [
  { id: "to-rate", label: "To Rate", gated: false },
  { id: "to-assess", label: "To Assess", gated: false },
  { id: "to-interview", label: "To Interview", gated: false },
  { id: "shoot", label: "Shoot", gated: false },
  { id: "qm", label: "QM", gated: false },
  { id: "to-hire", label: "To Hire", gated: false },
  { id: "hired", label: "Hired", gated: true },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export const HIRED_BLOCK =
  "Hired stays gated until a contract document is attached and a DNA verification says the contract is fully integrated. This move was not applied.";

export function stageLabel(stage: StageId): string {
  return STAGES.find((item) => item.id === stage)?.label ?? stage;
}

export function placeCandidate(
  stage: StageId,
  target: StageId,
): { stage: StageId; blocked: string | null } {
  if (target === "hired" && stage !== "hired") {
    return { stage, blocked: HIRED_BLOCK };
  }
  return { stage: target, blocked: null };
}

export function stepCandidate(
  stage: StageId,
  direction: -1 | 1,
): { stage: StageId; blocked: string | null } {
  const index = STAGES.findIndex((item) => item.id === stage);
  const next = index + direction;
  if (next < 0 || next >= STAGES.length) {
    return { stage, blocked: null };
  }
  return placeCandidate(stage, STAGES[next].id);
}
