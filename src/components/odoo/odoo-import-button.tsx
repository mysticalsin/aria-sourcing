"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { jsonBody, odooApi, type OdooJobLink } from "./api";
import { OdooJobPicker } from "./odoo-job-picker";
import { useOdooConnected } from "./use-odoo";

export interface ImportedOdooJob {
  jobId: number;
  jobName: string;
  brief: { email: string; jd: string };
}

/** Intake: "Import from Odoo" fills the brief from an Odoo job position.
 *  Renders nothing while Odoo is not connected. */
export function OdooImportButton({ onImported, disabled }: { onImported: (job: ImportedOdooJob) => void; disabled?: boolean }) {
  const connected = useOdooConnected();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  if (!connected) return null;

  async function pick(jobId: number) {
    setBusy(true);
    const res = await odooApi<{ job: { id: number; name: string }; brief: { email: string; jd: string } }>(`/jobs?id=${jobId}`);
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Odoo job not imported", description: res.error, variant: "error" });
      return;
    }
    setOpen(false);
    onImported({ jobId: res.data.job.id, jobName: res.data.job.name, brief: res.data.brief });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" leftIcon={<Download aria-hidden />} onClick={() => setOpen(true)} disabled={disabled}>
        Import from Odoo
      </Button>
      <OdooJobPicker
        open={open}
        onClose={() => setOpen(false)}
        onPick={(job) => pick(job.id)}
        busy={busy}
        title="Import an Odoo job position"
        description="The job's description, skills, location and recruiter become the brief. Review it, parse it, and the new campaign stays linked to this job."
        confirmLabel="Import"
      />
    </>
  );
}

/** After the campaign exists: link it to the job it was imported from. */
export async function linkCampaignToOdooJob(campaignId: string, jobId: number): Promise<{ ok: true; link: OdooJobLink } | { ok: false; error: string }> {
  const res = await odooApi<{ link: OdooJobLink }>("/links", jsonBody("POST", { campaignId, jobId }));
  return res.ok ? { ok: true, link: res.data.link } : { ok: false, error: res.error };
}
