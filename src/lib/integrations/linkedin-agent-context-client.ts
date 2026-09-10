/**
 * Browser-side helper: ask the server for Orca / Linki / OpenOutreach context
 * to personalize outreach. Never performs LinkedIn Connect/Message.
 */
export async function fetchLinkedInAgentContext(input: {
  profileUrl?: string;
  snippet?: string;
  icp?: string;
}): Promise<string | undefined> {
  const profileUrl = (input.profileUrl || "").trim();
  if (!profileUrl || !/linkedin\.com\/in\//i.test(profileUrl)) return undefined;
  try {
    const res = await fetch("/api/source/linkedin-research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "context",
        profileUrl,
        snippet: input.snippet,
        icp: input.icp,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; context?: string | null };
    if (!res.ok || !data.ok || !data.context) return undefined;
    return data.context;
  } catch {
    return undefined;
  }
}
