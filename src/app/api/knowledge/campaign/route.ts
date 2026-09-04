import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { defaultKnowledgePlane, type KnowledgeNoteKind } from "@/lib/knowledge-plane";
import { knowledgePlaneMayGrantContactClaim } from "@/lib/contact-lease";
import { validateBody } from "@/lib/api/validate";

export const dynamic = "force-dynamic";

/** Campaign knowledge plane — drafting recall only; never grants contact claims. */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId")?.trim() ?? "";
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  }
  const supabase = await getServerSupabase();
  let workspaceId = "__local__";
  if (supabase) {
    const { data: wid } = await supabase.rpc("current_workspace_id");
    if (!wid) return NextResponse.json({ error: "No workspace" }, { status: 401 });
    workspaceId = String(wid);

    const { data: rows } = await supabase
      .from("campaign_knowledge_notes")
      .select("id, kind, title, body, updated_at, campaign_id")
      .eq("workspace_id", wid)
      .eq("campaign_id", campaignId)
      .order("updated_at", { ascending: false })
      .limit(50);

    for (const row of rows ?? []) {
      await defaultKnowledgePlane.upsertNote({
        id: row.id,
        workspaceId,
        campaignId: row.campaign_id,
        kind: mapKind(row.kind),
        title: row.title,
        body: row.body,
        updatedAt: row.updated_at,
      });
    }
  }

  const snap = defaultKnowledgePlane.readCampaign(workspaceId, campaignId);
  return NextResponse.json({
    ...snap,
    draftContext: defaultKnowledgePlane.compileDraftContext(workspaceId, campaignId),
    grantsContactClaim: knowledgePlaneMayGrantContactClaim(),
  });
}

const UpsertSchema = z.object({
  campaignId: z.string().min(1).max(120),
  id: z.string().min(1).max(120).optional(),
  kind: z.enum(["purpose", "playbook", "objection", "who_what", "outcome"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
});

export async function POST(req: NextRequest) {
  const parsed = await validateBody(req, UpsertSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const supabase = await getServerSupabase();
  let workspaceId = "__local__";
  const noteId = body.id ?? `note_${Date.now().toString(36)}`;

  if (supabase) {
    const { data: wid } = await supabase.rpc("current_workspace_id");
    if (!wid) return NextResponse.json({ error: "No workspace" }, { status: 401 });
    workspaceId = String(wid);
    const { error } = await supabase.from("campaign_knowledge_notes").upsert(
      {
        id: noteId,
        workspace_id: wid,
        campaign_id: body.campaignId,
        kind: body.kind,
        title: body.title,
        body: body.body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,campaign_id,kind,title" },
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

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
  });
}

function mapKind(kind: string): KnowledgeNoteKind {
  if (kind === "purpose" || kind === "playbook" || kind === "objection" || kind === "outcome") {
    return kind;
  }
  return "who_what";
}
