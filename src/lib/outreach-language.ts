import { DEFAULT_LANGUAGE } from "@/lib/i18n";
import { languageLabelToCode } from "@/lib/mantu-need-parse";
import type { Campaign, Candidate } from "@/lib/types";

/**
 * Resolve the ISO language code for outreach copy.
 * Candidate spoken languages win over need locale, seat, and workspace default.
 */
export function resolveOutreachLanguage(opts: {
  candidate?: Pick<Candidate, "languages"> | null;
  campaign?: Pick<Campaign, "jobAnalysis"> | null;
  seatLanguage?: string | null;
  defaultLanguage?: string;
}): string {
  for (const label of opts.candidate?.languages ?? []) {
    const code = languageLabelToCode(label);
    if (code) return code;
  }

  const jd = opts.campaign?.jobAnalysis;
  const localePrimary = jd?.localeContext?.primaryLanguage?.trim();
  if (localePrimary) return localePrimary;

  const needLanguage = jd?.language?.trim();
  if (needLanguage) return needLanguage;

  const seatLanguage = opts.seatLanguage?.trim();
  if (seatLanguage) return seatLanguage;

  return opts.defaultLanguage?.trim() || DEFAULT_LANGUAGE;
}
