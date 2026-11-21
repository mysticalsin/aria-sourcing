import type { ApprovalQueueView } from "@/features/approvals/selectors";
import type { OdooSyncView } from "@/features/odoo-sync/projection";
import type { OutreachQueueView } from "@/features/outreach/selectors";
import type { PipelineView } from "@/features/pipeline/selectors";
import type { ReportsView } from "@/features/reports/selectors";
import type { SettingsView } from "@/features/settings/selectors";

/**
 * Read API for the recruiting console.
 * `workspace` serves today's store. A later Go client (`backend: "go-api"`)
 * implements the same methods against the aria-api process. Callers do not
 * choose a transport themselves.
 */
export interface ConsoleClient {
  readonly backend: "workspace" | "go-api";
  pipeline(): PipelineView;
  outreach(): OutreachQueueView;
  approvals(): ApprovalQueueView;
  odoo(): { preview: OdooSyncView };
  reports(): ReportsView;
  settings(): SettingsView;
}
