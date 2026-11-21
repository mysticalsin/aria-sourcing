import type { IntegrationStatus, SystemSettings } from "@/lib/types";

export interface SettingsView {
  settings: SystemSettings;
  integrations: IntegrationStatus[];
}

export function readSettings(settings: SystemSettings, integrations: IntegrationStatus[]): SettingsView {
  return { settings, integrations };
}

/**
 * The stored Supabase card is frozen at workspace creation. The page shows the
 * runtime flag instead, the same way login and persistence already do.
 */
export function projectSettingsIntegrations(
  integrations: readonly IntegrationStatus[],
  liveSupabase: boolean,
): IntegrationStatus[] {
  return integrations.map((integration) =>
    integration.id === "int_supabase"
      ? {
          ...integration,
          status: liveSupabase ? "connected" : "not_configured",
          mode: liveSupabase ? "live" : "mock",
          errors: liveSupabase ? [] : ["No project URL configured: demo runs on localStorage."],
        }
      : integration,
  );
}
