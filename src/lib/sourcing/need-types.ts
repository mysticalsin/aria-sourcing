/** Shared need types. Kept out of engine.ts so the VSS parser cannot cycle. */

export type NeedSource = "paste" | "email" | "upload";

export interface SourcingNeed {
  title: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  experienceSignals: string[];
  minYearsExperience: number | null;
  industry: string[];
  source: NeedSource;
  rawText: string;
}
