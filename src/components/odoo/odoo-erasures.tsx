"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";
import { Badge, Button, useToast } from "@/components/ui";
import { formatTimeAgo } from "@/lib/utils";
import { jsonBody, odooApi, type OdooErasureView } from "./api";

const STATUS: Record<OdooErasureView["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  deleted: { label: "Deleted in Odoo", tone: "success" },
  kept_hired: { label: "Kept: hired", tone: "warning" },
  pending: { label: "Pending", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

/**
 * Settings > Odoo > Erasures (admin): what happened in Odoo when a candidate
 * ARIA had sent there was erased in ARIA, with a retry for the ones Odoo did
 * not take. Candidates are shown by id only: their data is gone from ARIA.
 */
export function OdooErasures() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<OdooErasureView[] | null>(null);
  const [retrying, setRetrying] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await odooApi<{ erasures: OdooErasureView[] }>("/erasures");
    setRows(res.ok ? res.data.erasures : []);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function retry(candidateId: string) {
    setRetrying(candidateId);
    const res = await odooApi<{ erasure: OdooErasureView | null }>("/erasures", jsonBody("POST", { candidateId }));
    setRetrying(null);
    if (!res.ok) {
      toast({ title: "Retry failed", description: res.error, variant: "error" });
      return;
    }
    toast({ title: res.data.erasure ? STATUS[res.data.erasure.status].label : "Done", description: res.data.erasure?.detail ?? undefined, variant: "info" });
    await load();
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="space-y-1 border-t border-line pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Erasures in Odoo</p>
        <p className="text-xs text-muted">
          Erasing a candidate in ARIA also deletes the applicant ARIA created in Odoo (and its contact when Odoo created it
          for that application). A hired applicant is kept: HR decides. {rows ? "None so far." : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-line pt-4" data-odoo-erasures>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Erasures in Odoo</p>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {rows.map((row) => (
          <li key={row.candidateId} className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                Applicant #{row.applicantId}
                <Badge tone={STATUS[row.status].tone} size="sm">
                  {STATUS[row.status].label}
                </Badge>
              </p>
              <p className="text-xs text-muted">{row.detail}</p>
              <p className="text-xs text-muted">
                {formatTimeAgo(row.updatedAt)} · {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
              </p>
            </div>
            {(row.status === "pending" || row.status === "failed") && (
              <Button variant="subtle" size="sm" loading={retrying === row.candidateId} leftIcon={<RotateCw className="h-4 w-4" />} onClick={() => void retry(row.candidateId)}>
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
