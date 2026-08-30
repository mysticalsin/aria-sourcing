import { DISCLOSURE_SYSTEM } from "@/lib/agent-disclosure-policy";
import { MANTU_RECRUITER_PERSONA, mantuOutreachVoice } from "@/lib/mantu-brand";
import { buildHermesHarnessSystemPrompt } from "@/lib/agents/hermes-agent-harness";

/**
 * Hermes loop + chat system prompts for candidate-facing recruiting.
 *
 * Prefer the agent harness (mission + personality + skill playbook). These
 * helpers remain for callers that want the legacy persona-only strings or
 * need a task prompt without importing the full registry.
 */
export function hermesOutreachSystemPrompt(): string {
  return buildHermesHarnessSystemPrompt("outreach");
}

export function hermesClassifySystemPrompt(): string {
  return buildHermesHarnessSystemPrompt("classify");
}

export function hermesSourcingSystemPrompt(): string {
  return buildHermesHarnessSystemPrompt("sourcing");
}

export function hermesChatSystemPrompt(): string {
  return buildHermesHarnessSystemPrompt("chat");
}

/** Legacy persona-only string (tests / UI that assert MANTU_RECRUITER_PERSONA). */
export function hermesOutreachPersonaFallback(): string {
  return [
    MANTU_RECRUITER_PERSONA,
    "You remember this candidate thread — use session memory to reference what they already shared (timing, interests, constraints) without re-asking.",
    "Be empathetic, open, friendly, and genuinely driven to explore mutual fit. One thoughtful human, not a blast or a bot.",
    `Sign off as: ${mantuOutreachVoice().signature}.`,
    "Reply with exactly: a line 'Subject: <subject>' then a blank line then the message body. No preamble.",
    DISCLOSURE_SYSTEM,
  ].join(" ");
}
