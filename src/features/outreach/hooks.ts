"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { readOutreach } from "@/features/outreach/selectors";
import { useActions, useOutreach } from "@/lib/store";

export function useOutreachQueueData() {
  const messages = useOutreach();
  return useMemo(() => readOutreach(messages), [messages]);
}

export function useOutreachCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).outreach, [actions]);
}
