import type { ExactMessage } from "./types";

/** Rubric floor for a quality-check pass. Below this, automatic mode cannot send. */
export const MIN_QC_RUBRIC_SCORE = 80;

export interface QcEvaluation {
  pass: boolean;
  rubricScore: number;
  generic: boolean;
  reasons: string[];
}

/**
 * Stub interface for the quality-check agent. Implementations must not send
 * mail or call a network; the ledger hashes the message itself.
 */
export interface QualityCheckAgent {
  evaluate(message: ExactMessage): QcEvaluation | Promise<QcEvaluation>;
}

const GENERIC_PHRASES = [
  "i hope this message finds you well",
  "i hope this email finds you well",
  "i came across your profile",
  "dear sir or madam",
  "just bumping this",
  "just following up",
];

/** Deterministic generic-message detector used by the stub agent. No model call. */
export function detectGenericMessage(body: string): boolean {
  const text = body.trim().toLocaleLowerCase();
  if (text.length < 80) return true;
  return GENERIC_PHRASES.some((phrase) => text.includes(phrase));
}

/** A pass counts only when the agent says so, the rubric clears the floor, and the detector does not flag it. */
export function qcGateAccepts(evaluation: QcEvaluation): boolean {
  return (
    evaluation.pass === true &&
    Number.isFinite(evaluation.rubricScore) &&
    evaluation.rubricScore >= MIN_QC_RUBRIC_SCORE &&
    evaluation.generic === false
  );
}

/** In-process stand-in for the QC agent. The ledger still binds the pass to its own body hash. */
export function stubQualityCheckAgent(): QualityCheckAgent {
  return {
    evaluate(message) {
      const generic = detectGenericMessage(message.body);
      const rubricScore = generic ? MIN_QC_RUBRIC_SCORE - 40 : MIN_QC_RUBRIC_SCORE + 5;
      const pass = qcGateAccepts({ pass: !generic, rubricScore, generic, reasons: [] });
      return {
        pass,
        rubricScore,
        generic,
        reasons: pass ? [] : [generic ? "generic-message" : "rubric-below-floor"],
      };
    },
  };
}
