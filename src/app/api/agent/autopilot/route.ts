import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { isSameOriginRequest } from "@/lib/api/same-origin-json";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { agentsEnabled, serviceClient, type Svc } from "@/lib/agents/server/authority";
import { readWorkspace } from "@/lib/agents/server/workspace";
import { linkedInBridgeEnabled } from "@/lib/linkedin-bridge/policy";
import { parseAgentAllowlist } from "@/lib/agents/autopilot";

/* ============================================================================
   Campaign autopilot, for the signed-in user (ADR 0002).

   GET  ?campaignId=  the campaign's autopilot, its owner, the caller's
                      delegation, recent missions and the agent's contacts.
   POST enable        the caller becomes the campaign's owner for the agents:
                      a standing approval (nightly sourcing, then the best N
                      candidates contacted on LinkedIn from the caller's own
                      account, no click per message) plus a delegation.
        disable       the owner (or an admin) turns it off.
        run-now       the next tick sources this campaign.
        revoke        the caller withdraws every delegation (all campaigns).
   ========================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const campaignId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
const Settings = z.object({
  sourceEveryHours: z.number().int().min(1).max(168),
  sourceLimit: z.number().int().min(1).max(20),
  contactEnabled: z.boolean(),
  contactsPerRun: z.number().int().min(1).max(5),
  minScore: z.number().int().min(0).max(100),
}).strict();
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), campaignId, settings: Settings }).strict(),
  z.object({ action: z.literal("disable"), campaignId }).strict(),
  z.object({ action: z.literal("run-now"), campaignId }).strict(),
  z.object({ action: z.literal("revoke") }).strict(),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function caller(req: NextRequest) {
  if (prodFailClosed() || !supabaseEnabled) return null;
  const session = await getServerSupabase();
  if (!session) return null;
  const { data: { user } } = await session.auth.getUser();
  if (!user) return null;
  const [role, workspace] = await Promise.all([session.rpc("current_profile_role"), session.rpc("current_workspace_id")]);
  if (role.error || workspace.error || typeof workspace.data !== "string") return null;
  const svc = serviceClient();
  if (!svc) return null;
  const rl = checkRateLimit(rateLimitKey(req, "agent-autopilot", user.id), { max: 60, windowMs: 60_000 });
  return { svc, userId: user.id, workspaceId: workspace.data, role: role.data as Role, limited: rl.ok ? null : rl.retryAfterSec };
}

async function campaignExists(svc: Svc, workspaceId: string, id: string) {
  const ws = await readWorkspace(svc, workspaceId);
  return ws.state.campaigns.some((c) => c.id === id);
}

async function profileName(svc: Svc, userId: string) {
  const { data } = await svc.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return String(data?.full_name || data?.email || "Another user");
}

export async function GET(req: NextRequest) {
  const auth = await caller(req);
  if (!auth || !can(auth.role, "outreach")) return json({ ok: false, error: "Sign in with outreach permission." }, 403);
  if (auth.limited !== null) return tooManyRequests(auth.limited);
  const id = campaignId.safeParse(req.nextUrl.searchParams.get("campaignId"));
  if (!id.success) return json({ ok: false, error: "Invalid campaign." }, 400);
  const { svc, workspaceId, userId } = auth;
  const [pilot, delegation, missions, outreach, account] = await Promise.all([
    svc.from("agent_campaign_autopilots").select("*").eq("workspace_id", workspaceId).eq("campaign_id", id.data).maybeSingle(),
    svc.from("agent_delegations").select("scopes, revoked_at, granted_at").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
    svc.from("agent_missions").select("id, kind, status, summary, started_at, finished_at").eq("workspace_id", workspaceId)
      .eq("campaign_id", id.data).order("started_at", { ascending: false }).limit(10),
    svc.from("agent_outreach").select("candidate_id, state, kind, score, reason, updated_at").eq("workspace_id", workspaceId)
      .eq("campaign_id", id.data).order("created_at", { ascending: false }).limit(30),
    svc.from("linkedin_bridge_accounts").select("id, session_present, last_seen_at").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
  ]);
  if (pilot.error || delegation.error || missions.error || outreach.error || account.error) {
    return json({ ok: false, error: "Autopilot unavailable. Check database migrations (0009)." }, 503);
  }
  const row = pilot.data as Record<string, unknown> | null;
  return json({
    ok: true,
    agentsEnabled: agentsEnabled(),
    bridgeEnabled: linkedInBridgeEnabled(),
    // Only the count: the allowed profiles stay on the server.
    allowlistSize: parseAgentAllowlist(process.env.AGENTS_LINKEDIN_ALLOWLIST)?.size ?? null,
    autopilot: row && {
      enabled: row.enabled, mine: row.owner_id === userId, ownerName: row.owner_id === userId ? "you" : await profileName(svc, String(row.owner_id)),
      sourceEveryHours: row.source_every_hours, sourceLimit: row.source_limit, contactEnabled: row.contact_enabled,
      contactsPerRun: row.contacts_per_run, minScore: row.min_score, approvedAt: row.approved_at,
      lastSourceAt: row.last_source_at, lastContactAt: row.last_contact_at,
    },
    delegation: delegation.data ? { active: delegation.data.revoked_at === null, scopes: delegation.data.scopes } : null,
    linkedin: { connected: Boolean(account.data), lastSeenAt: account.data?.last_seen_at ?? null },
    missions: missions.data ?? [],
    contacts: outreach.data ?? [],
  });
}

export async function POST(req: NextRequest) {
  const auth = await caller(req);
  if (!auth || !can(auth.role, "outreach")) return json({ ok: false, error: "Sign in with outreach permission." }, 403);
  if (!isSameOriginRequest(req)) return json({ ok: false, error: "Cross-origin request refused." }, 403);
  if (auth.limited !== null) return tooManyRequests(auth.limited);
  const parsed = await validateBody(req, Body, { maxBytes: 2_000 });
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  const { svc, workspaceId, userId, role } = auth;
  const now = new Date().toISOString();
  try {
    if (input.action === "revoke") {
      const { error } = await svc.from("agent_delegations").update({ revoked_at: now, updated_at: now })
        .eq("workspace_id", workspaceId).eq("user_id", userId);
      if (error) throw new Error("revoke");
      return json({ ok: true });
    }
    if (!(await campaignExists(svc, workspaceId, input.campaignId))) return json({ ok: false, error: "Campaign not found." }, 404);
    const existing = await svc.from("agent_campaign_autopilots").select("owner_id, enabled")
      .eq("workspace_id", workspaceId).eq("campaign_id", input.campaignId).maybeSingle();
    if (existing.error) throw new Error("read");
    const ownedByOther = existing.data && existing.data.owner_id !== userId;
    const administrator = role === "admin";

    if (input.action === "enable") {
      if (!can(role, "source")) return json({ ok: false, error: "Sourcing permission required." }, 403);
      if (ownedByOther && existing.data?.enabled) {
        return json({ ok: false, error: `${await profileName(svc, String(existing.data.owner_id))} already runs this campaign's autopilot. They (or an admin) must turn it off first.` }, 409);
      }
      const s = input.settings;
      const pilot = await svc.from("agent_campaign_autopilots").upsert({
        workspace_id: workspaceId, campaign_id: input.campaignId, owner_id: userId, enabled: true,
        source_every_hours: s.sourceEveryHours, source_limit: s.sourceLimit, contact_enabled: s.contactEnabled,
        contacts_per_run: s.contactsPerRun, min_score: s.minScore, approved_at: now, updated_at: now,
      }, { onConflict: "workspace_id,campaign_id" });
      if (pilot.error) throw new Error("enable");
      const delegation = await svc.from("agent_delegations").upsert({
        workspace_id: workspaceId, user_id: userId, scopes: ["source", "draft", "queue_linkedin"],
        granted_at: now, revoked_at: null, updated_at: now,
      }, { onConflict: "workspace_id,user_id" });
      if (delegation.error) throw new Error("delegate");
      return json({ ok: true });
    }
    if (!existing.data) return json({ ok: false, error: "This campaign has no autopilot." }, 404);
    if (ownedByOther && !administrator) return json({ ok: false, error: "Only the campaign's autopilot owner or an admin can change it." }, 403);
    const patch = input.action === "disable" ? { enabled: false, updated_at: now } : { last_source_at: null, updated_at: now };
    const { error } = await svc.from("agent_campaign_autopilots").update(patch).eq("workspace_id", workspaceId).eq("campaign_id", input.campaignId);
    if (error) throw new Error("update");
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Autopilot could not be saved. Check database migrations (0009)." }, 503);
  }
}
