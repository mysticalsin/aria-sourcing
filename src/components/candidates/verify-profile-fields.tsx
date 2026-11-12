"use client";

import type { Campaign, Candidate, CompanyStage } from "@/lib/types";
import { Input, Label } from "@/components/ui";

/* The facts a recruiter checks on the source profile, laid out against the
   campaign brief: tick the requirements the profile shows, type the rest.
   Every value is the recruiter's own observation; nothing is pre-filled from
   the role or the search query, only from what the candidate record holds. */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const holds = (list: string[], item: string) => list.some((x) => same(x, item));

function CheckGroup({ legend, name, options, checked }: { legend: string; name: string; options: string[]; checked: (option: string) => boolean }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <label
            key={option}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-ink/[0.04] px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-inset ring-ink/10 has-[:checked]:bg-success-soft has-[:checked]:text-success has-[:checked]:ring-success/30"
          >
            <input type="checkbox" name={name} value={option} defaultChecked={checked(option)} className="h-3.5 w-3.5 accent-current" />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface VerifiedProfileValues {
  skills: string[];
  location: string;
  industryExperience: string[];
  companyStageExperience: CompanyStage[];
}

/** Read the fields below back out of the submitted form. */
export function readVerifiedProfile(values: FormData, candidate: Candidate, campaign: Campaign | undefined): VerifiedProfileValues {
  const jd = campaign?.jobAnalysis;
  const listed = (key: string) => values.getAll(key).map(String).map((s) => s.trim()).filter(Boolean);
  const others = String(values.get("otherSkills") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const briefIndustries = jd?.industryExperience ?? [];
  const briefStages = (jd?.companyStageTarget ?? []) as string[];
  return {
    skills: [...listed("skill"), ...others],
    location: String(values.get("location") ?? ""),
    // Facts outside the brief's list stay as they were; only the listed ones are toggled here.
    industryExperience: [...candidate.industryExperience.filter((i) => !holds(briefIndustries, i)), ...listed("industry")],
    companyStageExperience: [
      ...candidate.companyStageExperience.filter((s) => !briefStages.includes(s)),
      ...(listed("stage") as CompanyStage[]),
    ],
  };
}

export function VerifyProfileFields({ candidate, campaign }: { candidate: Candidate; campaign: Campaign | undefined }) {
  const jd = campaign?.jobAnalysis;
  const briefSkills = [...(jd?.requiredSkills ?? []), ...(jd?.niceToHaveSkills ?? [])];
  const otherSkills = candidate.techStack.filter((s) => !holds(briefSkills, s));
  return (
    <div className="space-y-4">
      <CheckGroup legend="Required and nice-to-have skills seen on the profile" name="skill" options={briefSkills} checked={(s) => holds(candidate.techStack, s)} />
      <div className="space-y-1.5">
        <Label htmlFor="verified-profile-other-skills">Other observed skills (comma-separated)</Label>
        <Input id="verified-profile-other-skills" name="otherSkills" maxLength={2000} defaultValue={otherSkills.join(", ")} placeholder="Optional" />
      </div>
      <CheckGroup legend="Industries the profile shows" name="industry" options={jd?.industryExperience ?? []} checked={(i) => holds(candidate.industryExperience, i)} />
      <CheckGroup legend="Company stages the profile shows" name="stage" options={(jd?.companyStageTarget ?? []) as string[]} checked={(s) => (candidate.companyStageExperience as string[]).includes(s)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="verified-profile-location">Location</Label>
          <Input id="verified-profile-location" name="location" maxLength={120} defaultValue={candidate.location} placeholder="Unknown" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="verified-profile-years">Years of experience</Label>
          <Input id="verified-profile-years" name="years" type="number" min={0} max={80} step="0.5" defaultValue={candidate.yearsExperience ?? ""} placeholder="Unknown" />
        </div>
      </div>
    </div>
  );
}
