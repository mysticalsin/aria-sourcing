"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { createWorkspaceConsoleClient } from "@/features/api/workspace-client";
import { useActions, useWorkspaceSnapshot } from "@/lib/store";

export function useReportsDesk() {
  const state = useWorkspaceSnapshot();
  const client = useMemo(() => createWorkspaceConsoleClient(state), [state]);
  const reports = useMemo(() => client.reports(), [client]);
  const odoo = useMemo(() => client.odoo().preview, [client]);
  return {
    campaigns: state.campaigns,
    activeId: state.activeCampaignId,
    reports: reports.reports,
    forCampaign: reports.forCampaign,
    odoo,
  };
}

export function useReportCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).reports, [actions]);
}
