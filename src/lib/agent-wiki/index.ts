/**
 * ARIA agent wiki / LLM second brain — public API.
 *
 * Filesystem notes live under docs/agent-wiki/. Runtime helpers here support
 * identity fingerprints, note IO, compaction, and feedback→proposal.
 */

export {
  fingerprintCandidateIdentity,
  samePerson,
  type CandidateIdentityInput,
  type CandidateIdentityFingerprint,
  type IdentityStrength,
} from "./identity";

export {
  parseWikiNote,
  serializeWikiNote,
  readWikiNote,
  writeWikiNote,
  listWikiMarkdownFiles,
  loadCanonicalLessons,
  stripAccidentalPii,
  wikiRoot,
  type WikiNote,
  type WikiFrontmatter,
  type WikiNoteKind,
  type WikiNoteStatus,
} from "./notes";

export { compactNotes, type CompactInput, type CompactResult } from "./compact";

export {
  proposeWikiLessonFromFeedback,
  persistProposedWikiLesson,
  tryStageWikiLessonFromFeedback,
  PROPOSED_WIKI_ROOT,
  type FeedbackVerdict,
  type ProposeLessonInput,
  type ProposedLesson,
} from "./feedback";
