"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { createWorkspaceConsoleClient } from "@/features/api/workspace-client";
import { projectSettingsIntegrations } from "@/features/settings/selectors";
import { useActions, useWorkspaceSnapshot } from "@/lib/store";
import { supabaseEnabled } from "@/lib/supabase/config";

export function useSettingsDesk() {
  const state = useWorkspaceSnapshot();
  const view = useMemo(() => createWorkspaceConsoleClient(state).settings(), [state]);
  const integrations = useMemo(
    () => projectSettingsIntegrations(view.integrations, supabaseEnabled),
    [view.integrations],
  );
  return { settings: view.settings, integrations };
}

export function useSettingsCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).settings, [actions]);
}
