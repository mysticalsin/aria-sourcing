import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { buildOutreachPrompt, parseHermesOutreach } from "@/lib/ai/hermes";
import { serverGenerateText } from "@/lib/ai/server-generate";
import { mantuOutreachVoice, mantuEmailHtmlWrapper } from "@/lib/mantu-brand";
import { generateOutreach, newOutreachMessage } from "@/lib/mock-ai";
import { humanizeText } from "@/lib/humanizer";
import { validateOutreachQuality } from "@/lib/outreach-quality-pipeline";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Candidate, Campaign, OutreachChannel, SystemSettings } from "@/lib/types";
import { candidateDisclosureContextForCampaignLike } from "@/lib/agent-disclosure-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  campaignId: z.string().min(1).max(100),
  candidateId: z.string().min(1).max(100),
  channel: z.enum(["Email", "LinkedIn"]).optional(),
});

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  return (
    secret !== "" &&
    presentedBuf.length === expectedBuf.length &&
    timingSafeEqual(presentedBuf, expectedBuf)
  );
}

export async function POST(req: NextRequest) {
  if (req.headers.get("cookie") || req.headers.get("origin")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });
  }

  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, status: "service_unavailable" }, { status: 503 });
  }

  const snapshot = await svc.rpc("read_workspace_state_for_loop", {
    p_workspace_id: parsed.data.workspaceId,
  });
  const body = snapshot.data as {
    status?: string;
    state?: { campaigns?: Campaign[]; candidates?: Candidate[] };
  } | null;
  if (snapshot.error || body?.status !== "ok" || !body.state) {
    return NextResponse.json({ ok: false, status: "workspace_unavailable" }, { status: 503 });
  }

  const campaign = (body.state.campaigns ?? []).find((c) => c.id === parsed.data.campaignId);
  const candidate = (body.state.candidates ?? []).find((c) => c.id === parsed.data.candidateId);
  if (!campaign || !candidate) {
    return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
  }

  const channel: OutreachChannel =
    parsed.data.channel ??
    (candidate.linkedinUrl ? "LinkedIn" : "Email");
  const voice = mantuOutreachVoice();
  const mockGenerated = generateOutreach(candidate, campaign, "Casual Professional", channel, 1, voice);

  let generated = mockGenerated;
  let modelUsed = false;
  const prompt = buildOutreachPrompt({
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
    tone: "Casual Professional",
    channel,
    language: campaign.jobAnalysis.language ?? "en",
    persona: voice.persona,
    signature: voice.signature,
  });
  const live = await serverGenerateText({
    system:
      "You write empathetic, Mantu-branded recruiting outreach. Never invent credentials. Never disclose salary. No AI self-disclosure. Reply with Subject: line then body.",
    prompt,
    maxTokens: 1024,
  });
  if (live.ok) {
    const parsedLive = parseHermesOutreach(live.text, channel, mockGenerated.subject);
    if (parsedLive) {
      generated = {
        ...mockGenerated,
        subject: humanizeText(parsedLive.subject),
        body: humanizeText(parsedLive.body),
      };
      modelUsed = true;
    }
  }

  const quality = validateOutreachQuality({
    subject: generated.subject,
    body: generated.body,
    channel,
  });
  const settings: Pick<SystemSettings, "dryRunMode"> = { dryRunMode: true };
  const outreach = newOutreachMessage(
    candidate,
    campaign,
    {
      ...generated,
      subject: quality.text.subject,
      body: quality.text.body,
    },
    "Casual Professional",
    settings as SystemSettings,
    1,
  );
  outreach.status = "Needs Approval";
  outreach.qualityStatus = quality.status;
  outreach.qualityScore = quality.aggregateScore;
  if (channel === "Email") {
    outreach.htmlBody = mantuEmailHtmlWrapper(quality.text.body);
  }

  return NextResponse.json({
    ok: true,
    campaignId: campaign.id,
    candidateId: candidate.id,
    channel,
    quality,
    outreach,
    modelUsed,
  });
}
