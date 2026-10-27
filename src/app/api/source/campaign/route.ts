import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { SourcePlanSchema, campaignSourcingBasis, orderedSteps, publicSourcingJob, jobStatus, type CampaignSourcingJob } from "@/lib/sourcing/unified-contract";
import { advanceUnifiedRun, reviewedCampaign } from "@/lib/sourcing/unified-run";
import { loadUnifiedJob, startUnifiedJob, unifiedRepository } from "@/lib/sourcing/unified-repository";
import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";
import { resolveStoredApifyKey, startProfileSearchRun, getRunStatus, fetchDatasetItems } from "@/lib/sourcing/apify";
import { searchGithubUsers } from "@/lib/sourcing/github";

export const runtime = "nodejs";
const campaignId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), campaignId, sources: SourcePlanSchema, requestKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("advance"), runId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("close"), runId: z.string().uuid() }).strict(),
]);
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
async function authority() {
  if (prodFailClosed() || !supabaseEnabled) return null;
  const session = await getServerSupabase();
  if (!session) return null;
  const { data: { user } } = await session.auth.getUser();
  if (!user) return null;
  const [role, workspace] = await Promise.all([session.rpc("current_profile_role"), session.rpc("current_workspace_id")]);
  if (role.error || workspace.error || typeof workspace.data !== "string" || !can(role.data as Role, "source")) return null;
  return { session, actorId: user.id, workspaceId: workspace.data, administrator: role.data === "admin" };
}
export async function GET(req: NextRequest) {
  const auth = await authority();
  if (!auth) return json({ ok: false, error: "Sign in with sourcing permission." }, 403);
  const id = campaignId.safeParse(req.nextUrl.searchParams.get("campaignId"));
  if (!id.success) return json({ ok: false, error: "Invalid campaign." }, 400);
  const service = getServiceSupabase();
  if (!service) return json({ ok: false, error: "Sourcing authority unavailable." }, 503);
  const { data, error } = await service.from("campaign_sourcing_jobs").select("*").eq("workspace_id", auth.workspaceId)
    .eq("campaign_id", id.data).order("created_at", { ascending: false }).limit(8);
  if (error) return json({ ok: false, error: "Sourcing history unavailable. Check database migrations." }, 503);
  return json({ ok: true, runs: (data as CampaignSourcingJob[]).map((j) => publicSourcingJob(j, auth.actorId, auth.administrator)) });
}
export async function POST(req: NextRequest) {
  const auth = await authority();
  if (!auth) return json({ ok: false, error: "Sign in with sourcing permission." }, 403);
  if (req.headers.get("origin") !== req.nextUrl.origin) return json({ ok: false, error: "Cross-origin sourcing is not allowed." }, 403);
  const rl = checkRateLimit(rateLimitKey(req, `campaign-source:${auth.workspaceId}:${auth.actorId}`), { max: 40, windowMs: 60_000 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const parsed = await validateBody(req, Body, { maxBytes: 3_000 });
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  try {
    if (input.action === "start") {
      const repo = unifiedRepository(auth.session, auth.workspaceId, auth.actorId, input.campaignId);
      const ws = await repo.readWorkspace();
      let campaign;
      try { campaign = reviewedCampaign(ws, input.campaignId); }
      catch { return json({ ok: false, error: "Complete and review the campaign brief, then move it to Sourcing or Outreach." }, 409); }
      for (const source of input.sources) {
        const cleared = clearDiscoveryCriteria(source.source === "LinkedIn" ? "Apify" : "GitHub", { query: source.query }, campaign);
        if (!cleared.ok) return json({ ok: false, error: cleared.error }, 422);
      }
      // Missing configuration is explicit before launch, with no silent fallback.
      if (input.sources.some((s) => s.source === "LinkedIn") && !(await resolveStoredApifyKey(auth.session))) {
        return json({ ok: false, error: "Connect an Apify key in Settings or deselect LinkedIn." }, 409);
      }
      const job = await startUnifiedJob({ ...auth, campaignId: input.campaignId, requestKey: input.requestKey,
        snapshot: campaignSourcingBasis(campaign), steps: orderedSteps(input.sources) });
      return json({ ok: true, run: publicSourcingJob(job, auth.actorId, auth.administrator) });
    }
    const job = await loadUnifiedJob(auth.workspaceId, input.runId);
    if (!job) return json({ ok: false, error: "Sourcing run not found." }, 404);
    if (job.actor_id !== auth.actorId && !(input.action === "close" && auth.administrator)) return json({ ok: false, error: "The initiating operator must resume this run. An administrator can close it." }, 403);
    if (input.action === "close") {
      if (job.status !== "active") return json({ ok: true, run: publicSourcingJob(job, auth.actorId, auth.administrator) });
      if (job.claim_until && Date.parse(job.claim_until) > Date.now()) return json({ ok: false, error: "A source operation is still finishing. Try closing again shortly." }, 409);
      const steps = job.steps.map((step) => ["queued", "starting", "running"].includes(step.status)
        ? { ...step, status: step.status === "queued" ? "failed" as const : "uncertain" as const,
          error: step.status === "queued" ? "Closed before this source started." : "Closed by operator. An already launched Apify actor may continue; check Apify before launching again." } : step);
      const { error } = await getServiceSupabase()!.from("campaign_sourcing_jobs").update({ status: jobStatus(steps), steps, revision: job.revision + 1 })
        .eq("workspace_id", auth.workspaceId).eq("id", job.id).eq("revision", job.revision);
      if (error) throw new Error("Run could not be closed.");
    } else {
      const repo = unifiedRepository(auth.session, auth.workspaceId, auth.actorId, job.campaign_id);
      try { await advanceUnifiedRun(job, repo, {
        apifyKey: async () => { await repo.readWorkspace(); return resolveStoredApifyKey(auth.session); },
        start: startProfileSearchRun, poll: getRunStatus, items: fetchDatasetItems,
        github: (clearance, query, count, signal) => searchGithubUsers(clearance, query, count, process.env.GITHUB_TOKEN ?? "", signal),
      }); } catch {
        // Completion may have committed before a secondary quota receipt failed.
        const latest = await loadUnifiedJob(auth.workspaceId, input.runId);
        if (!latest || latest.status === "active") throw new Error("Sourcing paused.");
      }
    }
    const saved = await loadUnifiedJob(auth.workspaceId, input.runId);
    if (!saved) throw new Error("Run could not be read.");
    return json({ ok: true, run: publicSourcingJob(saved, auth.actorId, auth.administrator) });
  } catch {
    // Do not leak database/provider messages or campaign PII in server errors.
    return json({ ok: false, error: "Sourcing paused. Resume the saved run. If the brief changed, close this run and review a new search." }, 503);
  }
}
