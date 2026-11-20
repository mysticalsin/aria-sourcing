/* ============================================================================
   Outreach copy written on the server, for the agents runner. Same prompt,
   system prompt, parsing and humanizer as the browser path
   (generateOutreachLive); the deterministic template stands in whenever the
   model is not configured, over budget, refused, truncated or unparseable.

   Only the workspace's own Anthropic vault key is used (never the
   deployment's environment key: that one is reserved to admins).
   ========================================================================== */

import "server-only";
import type { Campaign, Candidate, SystemSettings } from "@/lib/types";
import { generateOutreach, type GeneratedOutreach } from "@/lib/mock-ai";
import { buildOutreachPrompt, parseOutreachDraft } from "@/lib/ai/generate";
import { buildCloudRequest, cloudStopProblem, parseCloudResponse, resolveAiProvider, VAULT_PROVIDER } from "@/lib/ai/provider";
import { TASK_SYSTEM } from "@/lib/ai/task-system";
import { aiBudgetStatus, recordAiUsage, type AnthropicUsage } from "@/lib/ai/usage";
import { resolveWorkspaceVaultSecret } from "@/lib/ai/vault-secret";
import { candidateDisclosureContextForCampaignLike } from "@/lib/agent-disclosure-policy";
import { humanizeText } from "@/lib/humanizer";
import { effectiveTone } from "@/lib/skills";
const INVITATION_NOTE_MAX = 300;

/** Instruction added to the outreach prompt for each LinkedIn kind. Draft only; nothing is sent. */
function linkedInCopyRule(kind: "message" | "invitation"): string {
  return kind === "invitation"
    ? `This is a LinkedIn connection-invitation note: at most 280 characters in total, no subject needed (write 'Subject: LinkedIn' anyway), no links, one short sentence on why you reach out and a soft ask to connect.`
    : "This is a LinkedIn direct message to a 1st-degree connection: no links, under 90 words.";
}

/** Fit text into an invitation note: whole sentences first, then whole words. */
function fitInvitationNote(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= INVITATION_NOTE_MAX) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [];
  let out = "";
  for (const sentence of sentences) {
    const next = `${out} ${sentence.trim()}`.trim();
    if (next.length > INVITATION_NOTE_MAX) break;
    out = next;
  }
  if (out.length >= 80) return out;
  const words = clean.split(" ");
  out = "";
  for (const word of words) {
    if (`${out} ${word}`.trim().length > INVITATION_NOTE_MAX - 1) break;
    out = `${out} ${word}`.trim();
  }
  return `${out}…`;
}

export interface AgentDraft {
  gen: GeneratedOutreach;
  draftedBy: "ai" | "template";
}

const UPSTREAM_TIMEOUT_MS = 45_000;

async function claudeText(workspaceId: string, settings: SystemSettings, prompt: string): Promise<string | null> {
  const config = resolveAiProvider(settings, "outreach");
  if (!config || config.provider !== "anthropic" || !config.apiKeyId) return null;
  if (!aiBudgetStatus().ok) return null;
  const key = await resolveWorkspaceVaultSecret(workspaceId, config.apiKeyId, VAULT_PROVIDER.anthropic);
  if (!key) return null;
  const { url, headers, body } = buildCloudRequest("anthropic", config.model, TASK_SYSTEM.outreach, prompt, key, 2048, undefined, "outreach");
  try {
    const res = await fetch(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) {
      console.error("[agents] outreach draft upstream error", res.status);
      return null;
    }
    const json = await res.json().catch(() => null);
    const usage = (json as { usage?: AnthropicUsage } | null)?.usage;
    if (usage) recordAiUsage({ task: "outreach", activity: "first-contact", model: config.model, usage });
    if (cloudStopProblem("anthropic", json)) return null;
    return parseCloudResponse("anthropic", json) || null;
  } catch (cause) {
    console.error("[agents] outreach draft failed", cause instanceof Error ? cause.name : "error");
    return null;
  }
}

/** First-touch LinkedIn copy for one candidate: a message, or an invitation note (300 characters at most). */
export async function draftLinkedInOutreach(input: {
  workspaceId: string;
  settings: SystemSettings;
  skills: Parameters<typeof effectiveTone>[0];
  candidate: Candidate;
  campaign: Campaign;
  kind: "message" | "invitation";
}): Promise<AgentDraft> {
  const { candidate, campaign, settings, kind } = input;
  const tone = effectiveTone(input.skills);
  const language = campaign.jobAnalysis.language ?? settings.defaultLanguage;
  const template = generateOutreach(candidate, campaign, tone, "LinkedIn", 1, undefined, language);
  const fit = (gen: GeneratedOutreach): GeneratedOutreach => kind === "invitation" ? { ...gen, body: fitInvitationNote(gen.body) } : gen;

  const basePrompt = buildOutreachPrompt({
    candidateName: candidate.name,
    candidateTitle: candidate.currentTitle,
    candidateCompany: candidate.currentCompany,
    techStack: candidate.techStack,
    recentActivity: candidate.recentActivity,
    yearsExperience: candidate.yearsExperience,
    roleTitle: campaign.jobAnalysis.title,
    locationType: campaign.jobAnalysis.locationType,
    regions: campaign.jobAnalysis.regions,
    requiredSkills: campaign.jobAnalysis.requiredSkills,
    roleContext: candidateDisclosureContextForCampaignLike(campaign),
    tone,
    channel: "LinkedIn",
    language,
  });
  const guardrails = [settings.guardrails?.ariaPrompt, linkedInCopyRule(kind)].filter(Boolean).join("\n\n");
  const text = await claudeText(input.workspaceId, settings, `${guardrails}\n\n${basePrompt}`);
  const parsed = text ? parseOutreachDraft(text, "LinkedIn", template.subject) : null;
  if (!parsed) return { gen: fit(template), draftedBy: "template" };
  return {
    gen: fit({
      subject: humanizeText(parsed.subject),
      body: humanizeText(parsed.body),
      personalizationEvidence: template.personalizationEvidence,
      channel: "LinkedIn",
    }),
    draftedBy: "ai",
  };
}
