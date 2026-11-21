"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { useOdooSyncPreview } from "@/features/odoo-sync/hooks";
import { readReports } from "@/features/reports/selectors";
import { useActions, useActiveCampaignId, useCampaigns, useReports } from "@/lib/store";

export function useReportsDesk() {
  const reports = useReports();
  const campaigns = useCampaigns();
  const activeId = useActiveCampaignId();
  const odoo = useOdooSyncPreview();
  const view = useMemo(() => readReports(reports), [reports]);
  return { campaigns, activeId, reports: view.reports, forCampaign: view.forCampaign, odoo };
}

export function useReportCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).reports, [actions]);
}
