"use client";

import { useMemo } from "react";
import { projectOdooSync } from "@/features/odoo-sync/projection";
import { useCandidates } from "@/lib/store";

/** What the current workspace would hand to Odoo. Read-only. */
export function useOdooSyncPreview() {
  const candidates = useCandidates();
  return useMemo(() => projectOdooSync(candidates), [candidates]);
}
