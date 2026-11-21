"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { createWorkspaceConsoleClient } from "@/features/api/workspace-client";
import { useActions, useWorkspaceSnapshot } from "@/lib/store";

export function useApprovalQueue() {
  const state = useWorkspaceSnapshot();
  return useMemo(() => createWorkspaceConsoleClient(state).approvals().pending, [state]);
}

export function useApprovalCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).approvals, [actions]);
}
