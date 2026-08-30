/**
 * Strip scraped vanity metrics and GitHub-profile tells from activity text
 * before it enters outreach prompts / personalizationEvidence. Empathy critics
 * reject raw counts and "your GitHub activity" openers as mechanical scraping
 * disclosure. Scoring may still use the unsanitized field.
 */
export function sanitizeOutreachActivitySignal(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  if (!text || /no activity signal/i.test(text)) return "";
  return text
    .replace(
      /\d+[\s,]*(?:public\s+)?(?:repos?|dépôts?|followers?|stars?)(?:\s+(?:on\s+)?GitHub)?[^.,;]*/gi,
      "recent open-source work",
    )
    // Generic GitHub-profile boilerplate → concrete-work phrasing (avoids
    // "Votre activité GitHub récente" template tells that fail live critics).
    .replace(
      /\b(?:active\s+)?GitHub\s+profile(?:\s+with\s+recent\s+public\s+work)?\b/gi,
      "recent open-source work",
    )
    .replace(
      /\b(?:votre|vos|your)\s+(?:récente?\s+)?activité\s+GitHub(?:\s+récente)?\b/gi,
      "recent open-source work",
    )
    .replace(
      /\b(?:your\s+)?(?:recent\s+)?GitHub(?:\s+activity)?\b/gi,
      "recent open-source work",
    )
    .replace(/\b(?:votre|vos|your)\s+recent open-source work\b/gi, "recent open-source work")
    .replace(/(?:recent open-source work[\s,]*){2,}/gi, "recent open-source work")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();
}
