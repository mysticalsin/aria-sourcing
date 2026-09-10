import {
  analyzeLinkedInProfile,
  qualifyLeadAgainstIcp,
} from "@/lib/integrations/linkedin-browser-agents";

/** Build compact Orca + ICP context for outreach prompts. */
export async function buildLinkedInAgentContext(input: {
  profileUrl?: string;
  snippet?: string;
  icp?: string;
}): Promise<string | undefined> {
  const profileUrl = (input.profileUrl || "").trim();
  if (!profileUrl || !/linkedin\.com\/in\//i.test(profileUrl)) return undefined;

  const insight = await analyzeLinkedInProfile(profileUrl);
  const icp = await qualifyLeadAgainstIcp({
    profileUrl,
    snippet: input.snippet,
    icp:
      input.icp?.trim() ||
      "Enterprise AI / agentic systems / innovation leadership",
  });

  const lines = [
    insight.headline ? `Headline: ${insight.headline}` : null,
    insight.focusAreas.length ? `Focus: ${insight.focusAreas.slice(0, 3).join("; ")}` : null,
    insight.trajectoryNotes.length
      ? `Trajectory: ${insight.trajectoryNotes.slice(0, 2).join(" ")}`
      : null,
    insight.painPoints.length ? `Pain points: ${insight.painPoints.slice(0, 2).join("; ")}` : null,
    `ICP score: ${icp.score}/100 (${icp.via})`,
    ...icp.reasons.slice(0, 2),
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : undefined;
}
