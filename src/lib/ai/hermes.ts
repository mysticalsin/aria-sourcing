import type { OutreachChannel, SystemSettings } from "@/lib/types";

/* ============================================================================
   Aria live runtime — client helper.

   Thin wrapper around the server proxy at /api/hermes/chat. The proxy resolves
   the runtime URL + bearer token server-side (the secret never reaches the
   browser) and calls the hermes-agent OpenAI-compatible endpoint. This is
   TEXT GENERATION ONLY — it never triggers any send. Callers fall back to the
   deterministic mock when this returns { ok: false }.
   ========================================================================== */

export type HermesTask = "outreach" | "classify" | "sourcing" | "chat";

export interface HermesGenerateInput {
  task: HermesTask;
  system?: string;
  prompt: string;
  /** Cloud provider slug (e.g. "anthropic"). Absent → route uses hermes path. */
  provider?: string;
  /** ApiKey.id for the cloud provider. Raw secret resolved server-side only. */
  apiKeyId?: string;
  /** Model name/slug to request. Absent → route uses its own default. */
  model?: string;
}

export interface HermesResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

/**
 * Guard: live generation is only attempted when live mode is ON and a runtime
 * URL is configured. (The server route additionally accepts a HERMES_API_URL
 * env fallback, but that can't be read in the browser, so the client guard is
 * conservative — a misconfigured client simply falls back to the mock.)
 */
export function hermesAvailable(settings: SystemSettings): boolean {
  return !!(settings.hermesLiveMode && settings.hermesApiUrl);
}

/**
 * POST to the server proxy (non-stream). The settings carry the URL + key id so
 * the server can resolve the secret without the client ever holding it. Always
 * resolves to a HermesResult — network errors become { ok: false, reason }.
 */
export async function hermesGenerate(
  input: HermesGenerateInput & { hermesApiUrl?: string; hermesApiKeyId?: string },
): Promise<HermesResult> {
  try {
    const res = await fetch("/api/hermes/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, stream: false }),
    });
    const json = (await res.json().catch(() => ({ ok: false, reason: "Bad JSON from Aria proxy." }))) as HermesResult;
    return json;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Network error." };
  }
}

/**
 * Build a self-contained outreach prompt from the same inputs the mock uses, so
 * the live model produces a comparable, on-brand draft. The system prompt is
 * injected server-side; this is the user message.
 */
export function buildOutreachPrompt(opts: {
  candidateName: string;
  candidateTitle: string;
  candidateCompany: string;
  techStack: string[];
  recentActivity: string;
  yearsExperience: number;
  roleTitle: string;
  locationType: string;
  regions: string[];
  requiredSkills: string[];
  roleContext?: string;
  tone: string;
  channel: string;
  language: string;
  persona?: string;
  signature?: string;
}): string {
  const lines = [
    `Draft a first-touch ${opts.channel} recruiting message in this language (ISO code): ${opts.language}.`,
    `Tone: ${opts.tone}.`,
    opts.persona ? `Voice / persona: ${opts.persona}` : "",
    "",
    "Candidate:",
    `- Name: ${opts.candidateName}`,
    `- Current: ${opts.candidateTitle} at ${opts.candidateCompany}`,
    `- Experience: ${opts.yearsExperience} years`,
    `- Tech stack: ${opts.techStack.join(", ") || "n/a"}`,
    `- Recent activity: ${opts.recentActivity || "n/a"}`,
    "",
    "Role:",
    opts.roleContext ??
      [
        `- Title: ${opts.roleTitle}`,
        `- Setup: ${opts.locationType}${opts.regions.length ? ` (${opts.regions.join("/")})` : ""}`,
        `- Core skills: ${opts.requiredSkills.join(", ") || "n/a"}`,
      ].join("\n"),
    "",
    "Rules: lead with the candidate's specific recent work; one genuine reason you're reaching out; a soft, low-pressure ask. Under 120 words. No AI slop, no corporate filler.",
    opts.signature ? `Sign off with: ${opts.signature}` : "",
    "",
    "Reply with exactly: a line 'Subject: <subject>' then a blank line then the message body. No preamble, no commentary.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Parse a Aria text reply into the GeneratedOutreach shape. Tolerant: extracts
 * the `Subject:` line if present, otherwise synthesizes a subject from the first
 * body line. Returns null only when there is no usable body at all (caller then
 * falls back to the mock).
 */
export function parseHermesOutreach(
  text: string,
  channel: OutreachChannel,
  fallbackSubject: string,
): { subject: string; body: string } | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  const subjectMatch = trimmed.match(/^\s*subject\s*:\s*(.+)$/im);
  let subject = subjectMatch ? subjectMatch[1].trim() : "";
  let body = subjectMatch ? trimmed.replace(subjectMatch[0], "").trim() : trimmed;

  if (!subject) {
    const firstLine = body.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
    subject = firstLine.slice(0, 80) || fallbackSubject;
  }
  if (!body) return null;
  return { subject, body };
}
