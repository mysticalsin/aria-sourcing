/**
 * Europe / EMEA / UK geo + timezone signals for scoring and sourcing filters.
 * Used by `scoreLocation` so remote-ok / international Europe JDs still prefer
 * European candidates over far Americas/Asia zones.
 */
import type { Candidate, JobAnalysis } from "./types";

/** European place / country tokens (location strings + JD region tags). */
const EUROPE_PLACE_RE =
  /\b(?:europe|european|emea|eea|\beu\b|\buk\b|\bgb\b|united\s+kingdom|great\s+britain|england|scotland|wales|ireland|northern\s+ireland|germany|france|netherlands|holland|belgium|spain|italy|portugal|switzerland|austria|sweden|norway|denmark|finland|poland|czech(?:ia|\s+republic)?|romania|hungary|greece|luxembourg|slovakia|slovenia|croatia|bulgaria|estonia|latvia|lithuania|iceland|malta|cyprus|amsterdam|berlin|munich|hamburg|frankfurt|paris|lyon|london|manchester|dublin|madrid|barcelona|lisbon|rome|milan|brussels|zurich|geneva|vienna|stockholm|copenhagen|helsinki|oslo|warsaw|prague|budapest|athens|edinburgh|glasgow|birmingham|cologne|dusseldorf|rotterdam|the\s+hague)\b/i;

/** European working-hour zone labels (incl. UK GMT/BST and IANA Europe/*). */
const EUROPE_TZ_RE = /\b(?:CET|CEST|WET|WEST|BST|GMT|Europe\/[A-Za-z_]+)\b/i;

/** Americas / far-west zones that are poor overlap with CET/UK business hours. */
const AMERICAS_TZ_RE =
  /\b(?:EST|EDT|PST|PDT|CST|CDT|MST|MDT|AKST|HST|BRT|ART|America\/[A-Za-z_]+|US\/[A-Za-z_]+)\b/i;

const AMERICAS_PLACE_RE =
  /\b(?:united\s+states|\busa\b|\bu\.s\.a\.?\b|\bus\b|canada|mexico|brazil|argentina|chile|colombia|peru|toronto|montreal|montr[eé]al|vancouver|ottawa|calgary|new\s+york|san\s+francisco|seattle|chicago|austin|boston|los\s+angeles|miami|denver|atlanta|dallas|portland|eugene|sao\s+paulo|s[aã]o\s+paulo|buenos\s+aires|mexico\s+city|latam|americas?|oregon|california|washington|texas|florida|illinois|massachusetts|colorado|georgia|arizona|nevada|ohio|michigan|pennsylvania|virginia|north\s+carolina|new\s+jersey)\b/i;

/** Asia-Pacific zones far from European business hours. */
const ASIA_PACIFIC_TZ_RE =
  /\b(?:IST|SGT|JST|KST|HKT|PHT|AEST|AEDT|ACST|AWST|Asia\/[A-Za-z_]+|Australia\/[A-Za-z_]+)\b/i;

const ASIA_PACIFIC_PLACE_RE =
  /\b(?:india|singapore|japan|korea|hong\s+kong|philippines|thailand|vietnam|indonesia|malaysia|china|taiwan|australia|new\s+zealand|bangalore|bengaluru|mumbai|delhi|hyderabad|chennai|pune|tokyo|osaka|seoul|sydney|melbourne|auckland|shanghai|beijing|apac|asia[\s-]?pacific)\b/i;

function textLooksEuropean(text: string): boolean {
  return EUROPE_PLACE_RE.test(text) || EUROPE_TZ_RE.test(text);
}

function textLooksAmericas(text: string): boolean {
  return AMERICAS_PLACE_RE.test(text) || AMERICAS_TZ_RE.test(text);
}

function textLooksAsiaPacific(text: string): boolean {
  return ASIA_PACIFIC_PLACE_RE.test(text) || ASIA_PACIFIC_TZ_RE.test(text);
}

/**
 * True when the JD targets Europe / EMEA / UK / EU timezones or locations —
 * including remote-ok / international roles that still name a European focus.
 */
export function jobAnalysisIsEuropeFocused(
  jd: Pick<JobAnalysis, "regions" | "timezone" | "location"> & {
    locationType?: JobAnalysis["locationType"];
  },
): boolean {
  const blobs = [...(jd.regions ?? []), jd.timezone ?? "", jd.location ?? ""]
    .filter(Boolean)
    .join(" ");
  if (!blobs.trim()) return false;
  if (/\b(?:europe|european|emea|eea|\beu\b|\buk\b|\bgb\b)\b/i.test(blobs)) return true;
  if (EUROPE_TZ_RE.test(blobs) && !AMERICAS_TZ_RE.test(jd.timezone ?? "")) return true;
  if (EUROPE_PLACE_RE.test(blobs)) return true;
  return false;
}

/** Candidate is based in Europe or on a European working-hour timezone. */
export function candidateMatchesEurope(
  c: Pick<Candidate, "location" | "timezone">,
): boolean {
  const blob = `${c.location ?? ""} ${c.timezone ?? ""}`.trim();
  if (!blob) return false;
  return textLooksEuropean(blob);
}

/**
 * Candidate is clearly in Americas or Asia-Pacific (far from European hours).
 * Neutral/unknown geo returns false — only dampen confident mismatches.
 */
export function candidateIsFarFromEurope(
  c: Pick<Candidate, "location" | "timezone">,
): boolean {
  if (candidateMatchesEurope(c)) return false;
  const blob = `${c.location ?? ""} ${c.timezone ?? ""}`.trim();
  if (!blob) return false;
  return textLooksAmericas(blob) || textLooksAsiaPacific(blob);
}

/**
 * Macro Europe tags ("EU" / "EMEA" / "Europe") match any European location.
 */
export function locationMatchesEuropeMacro(location: string, region: string): boolean {
  const reg = region.trim();
  if (!/^(eu|eea|emea|europe|uk|gb)$/i.test(reg)) return false;
  return textLooksEuropean(location.trim().toLowerCase());
}

/**
 * Concrete location strings for provider filters (LinkedIn / GitHub / SMART)
 * when the JD is Europe-focused. Prefer city/country over bare "EU".
 */
export function europeSourcingLocationHints(
  jd: Pick<JobAnalysis, "regions" | "timezone" | "location">,
): string[] {
  if (!jobAnalysisIsEuropeFocused(jd)) return [];
  const hints: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !hints.some((h) => h.toLowerCase() === t.toLowerCase())) hints.push(t);
  };
  if (
    jd.location?.trim() &&
    !/^(eu|eea|emea|europe|remote|global|international)$/i.test(jd.location.trim())
  ) {
    push(jd.location.trim());
  }
  for (const r of jd.regions ?? []) {
    if (/^(eu|eea|emea|europe|remote|global|international)$/i.test(r.trim())) continue;
    if (/^(uk|gb)$/i.test(r.trim())) push("United Kingdom");
    else push(r);
  }
  const macro = [...(jd.regions ?? []), jd.location ?? ""].join(" ");
  if (/\b(?:eu|eea|emea|europe)\b/i.test(macro) || EUROPE_TZ_RE.test(jd.timezone ?? "")) {
    for (const h of ["Germany", "United Kingdom", "France", "Netherlands", "Spain"]) {
      push(h);
    }
  } else if (/\b(?:uk|gb|united\s+kingdom)\b/i.test(macro)) {
    push("United Kingdom");
    push("London");
  }
  return hints.slice(0, 6);
}
