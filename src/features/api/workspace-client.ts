import type { ConsoleClient } from "@/features/api/contract";
import { readApprovals } from "@/features/approvals/selectors";
import { projectOdooSync } from "@/features/odoo-sync/projection";
import { readOutreach } from "@/features/outreach/selectors";
import { readPipeline } from "@/features/pipeline/selectors";
import { readReports } from "@/features/reports/selectors";
import { readSettings } from "@/features/settings/selectors";
import type { WorkspaceState } from "@/lib/types";

/**
 * Today's data source: the workspace snapshot already loaded in the console.
 * Swap this factory for a Go-backed client when aria-api owns the reads.
 * Tests and the UI keep calling ConsoleClient either way.
 */
export function createWorkspaceConsoleClient(state: WorkspaceState): ConsoleClient {
  return {
    backend: "workspace",
    pipeline: () => readPipeline(state.campaigns, state.candidates),
    outreach: () => readOutreach(state.outreach),
    approvals: () => readApprovals(state.outreach),
    odoo: () => ({ preview: projectOdooSync(state.candidates) }),
    reports: () => readReports(state.reports),
    settings: () => readSettings(state.settings, state.integrations),
  };
}
