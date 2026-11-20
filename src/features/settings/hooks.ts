"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { projectSettingsIntegrations } from "@/features/settings/selectors";
import { useActions, useIntegrations, useSettings } from "@/lib/store";
import { supabaseEnabled } from "@/lib/supabase/config";

export function useSettingsDesk() {
  const settings = useSettings();
  const stored = useIntegrations();
  const integrations = useMemo(
    () => projectSettingsIntegrations(stored, supabaseEnabled),
    [stored],
  );
  return { settings, integrations };
}

export function useSettingsCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).settings, [actions]);
}
