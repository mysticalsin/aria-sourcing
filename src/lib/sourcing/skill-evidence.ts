// Which of a brief's skills the public text of a profile actually mentions.
//
// A brief states skills as phrases. A search result rarely repeats them word
// for word. A skill counts as observed when every meaningful word of it (or of
// one of its "or" alternatives) appears in the text as a whole word. Nothing
// is inferred from the role or the query. This is the quality bar that lets a
// sourcing batch stay large without treating weak, unmatched text as a fit.

const STOPWORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "into", "of", "on", "the", "to", "with",
  "level", "scale", "strong", "solid", "good", "proven", "experience", "skills", "skill", "knowledge",
  "et", "de", "des", "du", "la", "le", "les", "en", "pour", "avec",
]);

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

function words(text: string): Set<string> {
  const set = new Set<string>();
  for (const word of normalize(text).split(" ")) {
    if (!word) continue;
    set.add(word);
    if (word.length > 3 && word.endsWith("s")) set.add(word.slice(0, -1));
  }
  return set;
}

function alternatives(skill: string): { required: string[]; shortCaps: string[] }[] {
  const withoutAsides = skill.replace(/\([^)]*\)/g, " ");
  return withoutAsides
    .split(/\s+or\s+|\s+ou\s+|\s*\/\s*/i)
    .map((alt) => {
      const raw = alt.trim().split(/\s+/).filter(Boolean);
      const shortCaps = raw.filter((w) => /^[A-Z]{2}$/.test(w)).map((w) => w.toLowerCase());
      const required = normalize(alt)
        .split(" ")
        .filter((w) => w && !STOPWORDS.has(w) && !shortCaps.includes(w) && (w.length > 2 || /[+#]/.test(w)))
        .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
      return { required, shortCaps };
    })
    .filter((alt) => alt.required.length > 0 || alt.shortCaps.length > 0);
}

/** The skills, as written in the brief, whose words all appear in `text`. */
export function skillsObservedIn(text: string, skills: string[]): string[] {
  if (!text.trim()) return [];
  const found = words(text);
  const capitals = new Set((text.match(/\b[A-Z]{2}\b/g) ?? []).map((w) => w.toLowerCase()));
  return skills.filter((skill) =>
    alternatives(skill).some(
      (alt) => alt.required.every((w) => found.has(w)) && alt.shortCaps.every((w) => capitals.has(w)),
    ),
  );
}

/**
 * Volume stays. A public LinkedIn profile is weak when it states neither a
 * role nor any brief skill. Those profiles are not added to the batch.
 */
export function linkedInProfileMeetsQualityBar(profile: { title: string; text: string }, skills: string[]): boolean {
  if (profile.title.trim()) return true;
  return skillsObservedIn(profile.text, skills).length > 0;
}
