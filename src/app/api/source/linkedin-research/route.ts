import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildLinkedInAgentContext } from "@/lib/integrations/linkedin-agent-context";
import {
  analyzeLinkedInProfile,
  qualifyLeadAgainstIcp,
  searchLinkedInProfiles,
} from "@/lib/integrations/linkedin-browser-agents";

export const runtime = "nodejs";

const BodySchema = z.object({
  profileUrl: z.string().max(500).optional(),
  snippet: z.string().max(1000).optional(),
  icp: z.string().max(500).optional(),
  keywords: z.array(z.string().max(80)).max(12).optional(),
  mode: z.enum(["context", "analyze", "qualify", "search"]).default("context"),
});

/**
 * Thin research endpoint for Orca / NightTrek / Linki / OpenOutreach adapters.
 * Never performs LinkedIn Connect/Message.
 */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  const { profileUrl, snippet, icp, keywords, mode } = parsed.data;

  try {
    if (mode === "search") {
      const result = await searchLinkedInProfiles({
        keywords: keywords?.length ? keywords : ["software", "engineer"],
        limit: 8,
      });
      return NextResponse.json(result);
    }
    if (mode === "analyze") {
      if (!profileUrl) return NextResponse.json({ ok: false, error: "profileUrl required" }, { status: 400 });
      const insight = await analyzeLinkedInProfile(profileUrl);
      return NextResponse.json({ ok: true, insight });
    }
    if (mode === "qualify") {
      const result = await qualifyLeadAgainstIcp({
        profileUrl,
        snippet,
        icp: icp || "Enterprise AI / agentic systems / innovation leadership",
      });
      return NextResponse.json(result);
    }
    const context = await buildLinkedInAgentContext({ profileUrl, snippet, icp });
    return NextResponse.json({ ok: true, context: context ?? null });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "LinkedIn research failed." },
      { status: 502 },
    );
  }
}
