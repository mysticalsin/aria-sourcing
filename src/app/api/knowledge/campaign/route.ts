import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  defaultKnowledgePlane,
  seedJavaDeveloperWiki,
  type KnowledgeNoteKind,
} from "@/lib/knowledge-plane";
import { knowledgePlaneMayGrantContactClaim } from "@/lib/contact-lease";
import { validateBody } from "@/lib/api/validate";

export const dynamic = "force-dynamic";

/**
 * Campaign knowledge plane — durable LLM wiki on disk (ARIA_WIKI_DIR).
 * Drafting / sourcing recall only; never grants contact claims.
 * Supabase is not the brain store.
 */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId")?.trim() ?? "";
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  }
  const seedJava = req.nextUrl.searchParams.get("seed") === "java";
  const supabase = await getServerSupabase();
  let workspaceId = "__local__";
  if (supabase) {
    const { data: wid } = await supabase.rpc("current_workspace_id");
    if (!wid) return NextResponse.json({ error: "No workspace" }, { status: 401 });
    workspaceId = String(wid);
  }

  if (seedJava) {
    await seedJavaDeveloperWiki(workspaceId, campaignId);
  }

  const snap = defaultKnowledgePlane.readCampaign(workspaceId, campaignId);
  return NextResponse.json({
    ...snap,
    draftContext: defaultKnowledgePlane.compileDraftContext(workspaceId, campaignId),
    suggestedGithubQuery: defaultKnowledgePlane.suggestGithubQuery(workspaceId, campaignId),
    grantsContactClaim: knowledgePlaneMayGrantContactClaim(),
    brainStore: "llm-wiki",
  });
}

const UpsertSchema = z.object({
  campaignId: z.string().min(1).max(120),
  id: z.string().min(1).max(120).optional(),
  kind: z.enum(["purpose", "playbook", "objection", "who_what", "outcome"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  seedJava: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = await validateBody(req, UpsertSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const supabase = await getServerSupabase();
  let workspaceId = "__local__";
  if (supabase) {
    const { data: wid } = await supabase.rpc("current_workspace_id");
    if (!wid) return NextResponse.json({ error: "No workspace" }, { status: 401 });
    workspaceId = String(wid);
  }

  if (body.seedJava) {
    const snap = await seedJavaDeveloperWiki(workspaceId, body.campaignId);
    return NextResponse.json({
      seeded: true,
      ...snap,
      draftContext: defaultKnowledgePlane.compileDraftContext(workspaceId, body.campaignId),
      suggestedGithubQuery: defaultKnowledgePlane.suggestGithubQuery(workspaceId, body.campaignId),
      grantsContactClaim: knowledgePlaneMayGrantContactClaim(),
      brainStore: "llm-wiki",
    });
  }

  const noteId = body.id ?? `note_${Date.now().toString(36)}`;
  const note = await defaultKnowledgePlane.upsertNote({
    id: noteId,
    workspaceId,
    campaignId: body.campaignId,
    kind: body.kind,
    title: body.title,
    body: body.body,
  });

  return NextResponse.json({
    note,
    grantsContactClaim: knowledgePlaneMayGrantContactClaim(),
    brainStore: "llm-wiki",
    wikiPath: defaultKnowledgePlane.readCampaign(workspaceId, body.campaignId).wikiPath,
  });
}

export function mapKind(kind: string): KnowledgeNoteKind {
  if (kind === "purpose" || kind === "playbook" || kind === "objection" || kind === "outcome") {
    return kind;
  }
  return "who_what";
}
