/** Sourcing stages shown on the processing pipeline. Live candidate stages map in. */

export const PROCESSING_STAGES = [
  { id: "to-rate", label: "To Rate", sources: ["Sourced", "To Rate"] },
  { id: "to-assess", label: "To Assess", sources: ["Contacted", "To Assess"] },
  { id: "to-interview", label: "To Interview", sources: ["Replied", "Interested", "To Interview"] },
  { id: "shoot", label: "Shoot", sources: ["Booked", "Shoot"] },
  { id: "qm", label: "QM", sources: ["Interviewed", "QM"] },
  { id: "to-hire", label: "To Hire", sources: ["Offer", "To Hire"] },
  { id: "hired", label: "Hired", sources: ["Hired"] },
  { id: "rejected", label: "Rejected", sources: ["Rejected", "Not Interested"] },
  { id: "withdrawn", label: "Withdrawn", sources: ["Suppressed", "Withdrawn"] },
] as const;

export type ProcessingStageId = (typeof PROCESSING_STAGES)[number]["id"];

const STAGE_IDS = new Map<string, ProcessingStageId>();
for (const stage of PROCESSING_STAGES) {
  for (const source of stage.sources) STAGE_IDS.set(source, stage.id);
}

export function processingStageIdFor(stage: string | null | undefined): ProcessingStageId | null {
  if (!stage) return null;
  return STAGE_IDS.get(stage) ?? null;
}

export function processingStageLabel(id: ProcessingStageId): string {
  return PROCESSING_STAGES.find((stage) => stage.id === id)?.label ?? id;
}
