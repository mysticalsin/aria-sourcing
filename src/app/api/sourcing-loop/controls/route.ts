import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { safeLog } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

const ControlsSchema = z.object({
  killSwitch: z.boolean(),
  intakeEnabled: z.boolean(),
  sourcingEnabled: z.boolean(),
  enrichmentEnabled: z.boolean(),
  sequencesEnabled: z.boolean(),
  swarmEnabled: z.boolean().default(false),
  maxSourcingRunsPerDay: z.number().int().min(0).max(100).default(50),
  maxSequenceSendsPerDay: z.number().int().min(0).max(1000).default(200),
  maxEnrichmentUnitsPerDay: z.number().int().min(0).max(10000).default(1000),
});

type ControlsRow = {
  kill_switch: boolean;
  intake_enabled: boolean;
  sourcing_enabled: boolean;
  enrichment_enabled: boolean;
  sequences_enabled: boolean;
  swarm_enabled?: boolean;
  max_sourcing_runs_per_day: number;
  max_sequence_sends_per_day: number;
  max_enrichment_units_per_day: number;
  updated_at?: string | null;
};

function publicControls(row: ControlsRow) {
  return {
    killSwitch: row.kill_switch === true,
    intakeEnabled: row.intake_enabled === true,
    sourcingEnabled: row.sourcing_enabled === true,
    enrichmentEnabled: row.enrichment_enabled === true,
    sequencesEnabled: row.sequences_enabled === true,
    swarmEnabled: row.swarm_enabled === true,
    maxSourcingRunsPerDay: row.max_sourcing_runs_per_day,
    maxSequenceSendsPerDay: row.max_sequence_sends_per_day,
    maxEnrichmentUnitsPerDay: row.max_enrichment_units_per_day,
    updatedAt: row.updated_at ?? null,
    armed:
      row.kill_switch === false
      && row.intake_enabled === true
      && row.sourcing_enabled === true
      && row.sequences_enabled === true,
  };
}

async function loadControlsForWorkspace(workspaceId: string) {
  const svc = getServiceSupabase();
  if (!svc) {
    return { ok: false as const, status: 503 as const, error: "Service client unavailable." };
  }

  const { data, error } = await svc.rpc("get_sourcing_loop_controls", {
    p_workspace_id: workspaceId,
  });
  if (error) {
    safeLog("get_sourcing_loop_controls error", { message: error.message, code: error.code });
    return { ok: false as const, status: 503 as const, error: "Controls lookup failed." };
  }

  const row = (Array.isArray(data) ? data[0] : data) as ControlsRow | null;
  if (!row) {
    return {
      ok: true as const,
      controls: publicControls({
        kill_switch: true,
        intake_enabled: false,
        sourcing_enabled: false,
        enrichment_enabled: false,
        sequences_enabled: false,
        swarm_enabled: false,
        max_sourcing_runs_per_day: 10,
        max_sequence_sends_per_day: 50,
        max_enrichment_units_per_day: 200,
      }),
    };
  }

  return { ok: true as const, controls: publicControls(row) };
}

/**
 * Admin read/write for the workspace sourcing-loop switchboard.
 * GET uses service-role RPC (table is not authenticated-readable).
 * PATCH calls authenticated set_sourcing_loop_controls (admin-gated in DB).
 */
export async function GET() {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      demo: true,
      controls: {
        killSwitch: true,
        intakeEnabled: false,
        sourcingEnabled: false,
        enrichmentEnabled: false,
        sequencesEnabled: false,
        swarmEnabled: false,
        maxSourcingRunsPerDay: 10,
        maxSequenceSendsPerDay: 50,
        maxEnrichmentUnitsPerDay: 200,
        updatedAt: null,
        armed: false,
      },
    });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Auth unavailable." }, { status: 503 });
  }
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin.response;

  const { data: workspaceId, error: widErr } = await supabase.rpc("current_workspace_id");
  if (widErr || !workspaceId) {
    return NextResponse.json({ ok: false, error: "Workspace required." }, { status: 403 });
  }

  const loaded = await loadControlsForWorkspace(String(workspaceId));
  if (!loaded.ok) {
    return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
  }
  return NextResponse.json({ ok: true, controls: loaded.controls });
}

export async function PATCH(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json(
      { ok: false, error: "Loop switchboard requires a live workspace (not demo)." },
      { status: 503 },
    );
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Auth unavailable." }, { status: 503 });
  }
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin.response;

  const parsed = await validateBody(req, ControlsSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Fail-closed CHECK: stages cannot be enabled while kill switch is on.
  if (
    body.killSwitch
    && (body.intakeEnabled || body.sourcingEnabled || body.enrichmentEnabled || body.sequencesEnabled || body.swarmEnabled)
  ) {
    return NextResponse.json(
      { ok: false, error: "Disable the kill switch before enabling loop stages." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("set_sourcing_loop_controls", {
    p_kill_switch: body.killSwitch,
    p_intake_enabled: body.intakeEnabled,
    p_sourcing_enabled: body.sourcingEnabled,
    p_enrichment_enabled: body.enrichmentEnabled,
    p_sequences_enabled: body.sequencesEnabled,
    p_swarm_enabled: body.swarmEnabled,
    p_max_sourcing_runs_per_day: body.maxSourcingRunsPerDay,
    p_max_sequence_sends_per_day: body.maxSequenceSendsPerDay,
    p_max_enrichment_units_per_day: body.maxEnrichmentUnitsPerDay,
  });

  if (error) {
    safeLog("set_sourcing_loop_controls error", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Controls update failed." }, { status: 503 });
  }

  const status = (data as { status?: string } | null)?.status ?? "unknown";
  if (status !== "updated") {
    return NextResponse.json({ ok: false, error: `Controls not updated (${status}).` }, { status: 400 });
  }

  const { data: workspaceId } = await supabase.rpc("current_workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ ok: true, status: "updated" });
  }
  const loaded = await loadControlsForWorkspace(String(workspaceId));
  if (!loaded.ok) {
    return NextResponse.json({ ok: true, status: "updated" });
  }
  return NextResponse.json({ ok: true, status: "updated", controls: loaded.controls });
}
