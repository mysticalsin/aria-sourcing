/**
 * Strip scraped vanity metrics from activity text before it enters outreach
 * prompts / personalizationEvidence. Empathy critics reject raw counts like
 * "60 public repos" as mechanical. Scoring may still use the unsanitized field.
 */
export function sanitizeOutreachActivitySignal(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  if (!text || /no activity signal/i.test(text)) return "";
  return text
    .replace(
      /\d+[\s,]*(?:public\s+)?(?:repos?|dépôts?|followers?|stars?)(?:\s+(?:on\s+)?GitHub)?[^.,;]*/gi,
      "recent open-source work",
    )
    .replace(/(?:recent open-source work[\s,]*){2,}/gi, "recent open-source work")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();
}
