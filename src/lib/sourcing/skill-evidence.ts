// Which of a brief's skills the public text of a profile actually mentions.
//
// A brief states skills as phrases ("AI adoption and change management at
// scale", "IT or digital transformation"); a search result never repeats them
// word for word. A skill counts as observed when every meaningful word of it
// (or of one of its "or" alternatives) appears in the text as a whole word.
// It stays evidence-based: nothing is inferred from the role or the query,
// only words the text contains.

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
    // Plural tolerance both ways: "frameworks" covers "framework".
    if (word.length > 3 && word.endsWith("s")) set.add(word.slice(0, -1));
  }
  return set;
}

/** The words that must all appear for each alternative of a skill phrase. */
function alternatives(skill: string): { required: string[]; shortCaps: string[] }[] {
  const withoutAsides = skill.replace(/\([^)]*\)/g, " ");
  return withoutAsides
    .split(/\s+or\s+|\s+ou\s+|\s*\/\s*/i)
    .map((alt) => {
      const raw = alt.trim().split(/\s+/).filter(Boolean);
      // Two-letter tokens ("IT", "AI", "UX") are only trusted in capitals,
      // so the English word "it" never counts as the skill "IT".
      const shortCaps = raw.filter((w) => /^[A-Z]{2}$/.test(w)).map((w) => w.toLowerCase());
      const required = normalize(alt)
        .split(" ")
        .filter((w) => w && !STOPWORDS.has(w) && !shortCaps.includes(w) && (w.length > 2 || /[+#]/.test(w)))
        // Singular form: the text's word set holds both forms (see words()).
        .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
      return { required, shortCaps };
    })
    .filter((alt) => alt.required.length > 0 || alt.shortCaps.length > 0);
}

/** The skills (as written in the brief) whose words all appear in `text`. */
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
