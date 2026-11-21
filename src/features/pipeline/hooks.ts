"use client";

import { useMemo } from "react";
import { readPipeline } from "@/features/pipeline/selectors";
import { bindConsoleCommands } from "@/features/api/commands";
import { useActions, useCampaigns, useCandidates } from "@/lib/store";

export function usePipelineBoard() {
  const campaigns = useCampaigns();
  const candidates = useCandidates();
  return useMemo(() => readPipeline(campaigns, candidates), [campaigns, candidates]);
}

export function usePipelineCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).pipeline, [actions]);
}
