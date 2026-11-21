"use client";

import { useMemo } from "react";
import { bindConsoleCommands } from "@/features/api/commands";
import { readApprovals } from "@/features/approvals/selectors";
import { useActions, useOutreach } from "@/lib/store";

export function useApprovalQueue() {
  const messages = useOutreach();
  return useMemo(() => readApprovals(messages).pending, [messages]);
}

export function useApprovalCommands() {
  const actions = useActions();
  return useMemo(() => bindConsoleCommands(actions).approvals, [actions]);
}
