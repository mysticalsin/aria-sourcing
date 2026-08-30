import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { serializeWikiNote, stripAccidentalPii, type WikiNote, wikiRoot } from "./notes";

export type FeedbackVerdict = "useful" | "dead_end" | "corrected";

export type ProposeLessonInput = {
  receiptId: string;
  verdict: FeedbackVerdict;
  /** Aggregate platform label only (e.g. GitHub) — never a person name. */
  platform?: string;
  /** Optional opaque role fingerprint (sha256). */
  roleFingerprint?: string | null;
  /** Short aggregate observation (must be PII-free). */
  observation?: string;
  root?: string;
  now?: Date;
};

export type ProposedLesson = {
  path: string;
  note: WikiNote;
  markdown: string;
};

/** Staging root for auto-proposed lessons (gitignored via var/). */
export const PROPOSED_WIKI_ROOT = "var/agent-wiki/proposed";

/**
 * Turn a sourcing feedback verdict into a *proposed* wiki lesson note.
 * Does not write to disk — caller decides after review gates.
 */
export function proposeWikiLessonFromFeedback(input: ProposeLessonInput): ProposedLesson {
  const now = (input.now ?? new Date()).toISOString().slice(0, 10);
  const short = input.receiptId.replace(/-/g, "").slice(0, 8);
  const id = `lesson-proposed-${short}-${input.verdict}`;
  const platform = input.platform?.trim() || "unknown";
  const observation = stripAccidentalPii(
    (input.observation ?? "").trim() || `Receipt marked ${input.verdict} for ${platform}.`,
  );

  const rule =
    input.verdict === "useful"
      ? `Prefer repeating this ${platform} query pattern when the role fingerprint matches.`
      : input.verdict === "dead_end"
        ? `Avoid repeating this ${platform} query pattern for matching roles until corrected.`
        : `Treat this ${platform} query pattern as needing human correction before reuse.`;

  const body = [
    `# Proposed lesson (${input.verdict})`,
    "",
    "## Context",
    observation,
    "",
    "## Rule",
    rule,
    "",
    "## Counterexample",
    "Do not apply across different role fingerprints or identity scopes.",
    "",
    "## Evidence",
    `Receipt \`${input.receiptId}\` (opaque).`,
    "",
  ].join("\n");

  const note: WikiNote = {
    path: "",
    frontmatter: {
      id,
      kind: "lesson",
      status: "proposed",
      updated: now,
      supersedes: [],
      evidence: [input.receiptId],
      roleFingerprint: input.roleFingerprint ?? null,
      identityFingerprint: null,
    },
    body,
    raw: "",
  };
  const markdown = serializeWikiNote(note);
  note.raw = markdown;
  const root = wikiRoot(input.root);
  const path = join(root, "lessons", `${id}.md`);
  note.path = path;
  return { path, note, markdown };
}

/**
 * Persist a proposed lesson under var/agent-wiki/proposed/ (never docs/).
 * Promotion into docs/agent-wiki/lessons/ remains a human/admin step.
 */
export function persistProposedWikiLesson(
  proposed: ProposedLesson,
  stagingRoot = PROPOSED_WIKI_ROOT,
): string {
  const filePath = join(stagingRoot, `${proposed.note.frontmatter.id}.md`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, proposed.markdown, "utf8");
  return filePath;
}

/** Best-effort: propose + stage a lesson from a feedback verdict. Never throws. */
export function tryStageWikiLessonFromFeedback(input: ProposeLessonInput): string | null {
  if (process.env.ARIA_AGENT_WIKI_AUTO_PROPOSE === "0") return null;
  try {
    const proposed = proposeWikiLessonFromFeedback(input);
    return persistProposedWikiLesson(proposed);
  } catch {
    return null;
  }
}
