"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { createWorkspaceConsoleClient } from "@/features/api/workspace-client";
import { useActions, useWorkspaceSnapshot } from "@/lib/store";

export function useOutreachQueueData() {
  const state = useWorkspaceSnapshot();
  return useMemo(() => createWorkspaceConsoleClient(state).outreach(), [state]);
}

export function useOutreachCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).outreach, [actions]);
}
