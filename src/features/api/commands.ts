import type { WorkspaceActions } from "@/lib/store/contracts";

export interface ConsoleCommands {
  pipeline: Pick<WorkspaceActions, "setCandidateStage" | "setRejectionReason" | "toggleVivier" | "addCandidateNote">;
  outreach: Pick<
    WorkspaceActions,
    | "generateOutreachFor"
    | "generateOutreachLive"
    | "updateOutreach"
    | "regenerateOutreach"
    | "draftFollowUpFor"
    | "draftRecontactFor"
  >;
  approvals: Pick<WorkspaceActions, "approveOutreach" | "rejectOutreach" | "sendApprovedOutreach" | "confirmManualSend">;
  reports: Pick<WorkspaceActions, "generateReport" | "setSkillUpdateStatus">;
  settings: Pick<WorkspaceActions, "updateSettings" | "updateIntegration" | "toggleIntegrationMode" | "testIntegration">;
}

/** Group the existing store actions by feature. Does not add a send path. */
export function bindConsoleCommands(actions: WorkspaceActions): ConsoleCommands {
  return {
    pipeline: {
      setCandidateStage: actions.setCandidateStage,
      setRejectionReason: actions.setRejectionReason,
      toggleVivier: actions.toggleVivier,
      addCandidateNote: actions.addCandidateNote,
    },
    outreach: {
      generateOutreachFor: actions.generateOutreachFor,
      generateOutreachLive: actions.generateOutreachLive,
      updateOutreach: actions.updateOutreach,
      regenerateOutreach: actions.regenerateOutreach,
      draftFollowUpFor: actions.draftFollowUpFor,
      draftRecontactFor: actions.draftRecontactFor,
    },
    approvals: {
      approveOutreach: actions.approveOutreach,
      rejectOutreach: actions.rejectOutreach,
      sendApprovedOutreach: actions.sendApprovedOutreach,
      confirmManualSend: actions.confirmManualSend,
    },
    reports: {
      generateReport: actions.generateReport,
      setSkillUpdateStatus: actions.setSkillUpdateStatus,
    },
    settings: {
      updateSettings: actions.updateSettings,
      updateIntegration: actions.updateIntegration,
      toggleIntegrationMode: actions.toggleIntegrationMode,
      testIntegration: actions.testIntegration,
    },
  };
}
