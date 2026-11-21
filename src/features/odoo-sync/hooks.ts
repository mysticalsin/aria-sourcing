"use client";

import { useMemo } from "react";
import { createWorkspaceConsoleClient } from "@/features/api/workspace-client";
import { useWorkspaceSnapshot } from "@/lib/store";

/** Local preview of what the workspace would hand to Odoo. No write. */
export function useOdooSyncPreview() {
  const state = useWorkspaceSnapshot();
  return useMemo(() => createWorkspaceConsoleClient(state).odoo().preview, [state]);
}
