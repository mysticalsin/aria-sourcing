"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { createWorkspaceConsoleClient } from "@/features/api/workspace-client";
import { useActions, useWorkspaceSnapshot } from "@/lib/store";

export function usePipelineBoard() {
  const state = useWorkspaceSnapshot();
  return useMemo(() => createWorkspaceConsoleClient(state).pipeline(), [state]);
}

export function usePipelineCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).pipeline, [actions]);
}
