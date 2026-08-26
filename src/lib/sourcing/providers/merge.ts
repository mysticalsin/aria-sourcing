import type { Candidate } from "@/lib/types";
import type { SourcingProvider } from "./types";

const RICHNESS_RANK: Record<SourcingProvider["richness"], number> = {
  profile: 3,
  identity: 2,
  serp: 1,
};

function dedupeKey(c: Candidate): string | null {
  const li = c.linkedinUrl.trim().toLowerCase();
  if (li) return `li:${li}`;
  const gh = c.githubUrl.trim().toLowerCase();
  if (gh) return `gh:${gh}`;
  const su = (c.sourceUrl ?? "").trim().toLowerCase();
  if (su) return `su:${su}`;
  const email = c.email.trim().toLowerCase();
  if (email) return `em:${email}`;
  const nameCo = `${c.name.trim().toLowerCase()}|${c.currentCompany.trim().toLowerCase()}`;
  if (c.name.trim() && c.currentCompany.trim()) return `nc:${nameCo}`;
  return null;
}

/**
 * Merge hits preferring richer backends (LinkedIn profiles > GitHub identity > SERP).
 * Same person from profile search wins over a thin LinkedIn SERP snippet.
 */
export function mergePreferringRicher(
  batches: { provider: SourcingProvider; candidates: Candidate[] }[],
): Candidate[] {
  const ordered = [...batches].sort(
    (a, b) => RICHNESS_RANK[b.provider.richness] - RICHNESS_RANK[a.provider.richness],
  );
  const byKey = new Map<string, Candidate>();
  const unkeyed: Candidate[] = [];
  for (const { candidates } of ordered) {
    for (const cand of candidates) {
      const key = dedupeKey(cand);
      if (!key) {
        unkeyed.push(cand);
        continue;
      }
      if (!byKey.has(key)) byKey.set(key, cand);
    }
  }
  return [...byKey.values(), ...unkeyed];
}
