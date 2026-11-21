import type { WorkspaceActions } from "@/lib/store/contracts";
import { makeActivity, withActivity } from "@/lib/store/workspace-transitions";
import type { IntegrationStatus, SystemSettings, WorkspaceState } from "@/lib/types";

export type SettingsActions = Pick<
  WorkspaceActions,
  "updateSettings" | "updateIntegration" | "toggleIntegrationMode"
>;

export interface SettingsActionDependencies {
  commit: (update: (state: WorkspaceState) => WorkspaceState) => boolean;
}

/** Workspace settings mutations. React-free; the store supplies commit. */
export function createSettingsActions(deps: SettingsActionDependencies): SettingsActions {
  const commit = deps.commit;

  const updateSettings = (patch: Partial<SystemSettings>) =>
    commit((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  const updateIntegration = (id: string, patch: Partial<IntegrationStatus>) =>
    commit((s) => ({
      ...s,
      integrations: s.integrations.map((integration) =>
        integration.id === id ? { ...integration, ...patch } : integration,
      ),
    }));

  const toggleIntegrationMode = (id: string) =>
    commit((state) => {
      const next = {
        ...state,
        integrations: state.integrations.map((integration) =>
          integration.id === id
            ? { ...integration, mode: integration.mode === "mock" ? ("live" as const) : ("mock" as const) }
            : integration,
        ),
      };
      const integration = state.integrations.find((item) => item.id === id);
      return withActivity(
        next,
        makeActivity({
          type: "system",
          title: "Integration mode changed",
          notes: `${integration?.name ?? id} → ${integration?.mode === "mock" ? "live" : "mock"}.`,
          outcome: integration?.mode === "mock" ? "live" : "mock",
          campaignId: null,
          linkedEntityType: null,
          linkedEntityId: null,
        }),
        null,
      );
    });

  return { updateSettings, updateIntegration, toggleIntegrationMode };
}
