"use client";

import * as React from "react";
import { ExternalLink, Link2, RefreshCw } from "lucide-react";
import { Badge, Button, useToast } from "@/components/ui";
import { can } from "@/lib/rbac";
import { useCampaignCandidates, useRole } from "@/lib/store";
import { jsonBody, odooApi, type OdooJobLink } from "./api";
import { OdooJobPicker } from "./odoo-job-picker";
import { notifyOdooChanged, useOdooCampaign, useOdooConnected } from "./use-odoo";

/**
 * Campaign page strip: which Odoo job position this campaign feeds, how many
 * of its candidates are in Odoo, and the sync that brings Odoo's stages back
 * (also pushed by Odoo itself when live updates are on).
 * Renders nothing while Odoo is not connected for the workspace.
 */
export function CampaignOdooBar({ campaignId }: { campaignId: string }) {
  const connected = useOdooConnected();
  const role = useRole();
  const canSource = can(role, "source");
  const candidates = useCampaignCandidates(campaignId);
  const { toast } = useToast();
  // With the source permission, opening the campaign applies Odoo's outcome
  // on the server (same path as the Odoo webhook); viewers only read it.
  const odoo = useOdooCampaign(campaignId, connected, canSource);
  const [picking, setPicking] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const announcedRef = React.useRef<string>("");

  React.useEffect(() => {
    if (odoo.changes.length === 0) return;
    const key = odoo.changes.map((c) => `${c.candidateId}:${c.to}`).join("|");
    if (announcedRef.current === key) return;
    announcedRef.current = key;
    const name = (id: string) => candidates.find((c) => c.id === id)?.name ?? "A candidate";
    toast({
      title: `Odoo: ${odoo.changes.length} candidate${odoo.changes.length === 1 ? "" : "s"} moved`,
      description: odoo.changes.map((c) => `${name(c.candidateId)}: ${c.from} → ${c.to}`).join(", "),
      variant: "info",
    });
  }, [candidates, odoo.changes, toast]);

  if (!connected) return null;

  async function link(jobId: number) {
    setLinking(true);
    const res = await odooApi<{ link: OdooJobLink }>("/links", jsonBody("POST", { campaignId, jobId }));
    setLinking(false);
    if (!res.ok) {
      toast({ title: "Not linked", description: res.error, variant: "error" });
      return;
    }
    setPicking(false);
    notifyOdooChanged();
    toast({ title: "Linked to Odoo", description: `Candidates you send to Odoo land on “${res.data.link.jobName}”.`, variant: "success" });
  }

  const inOdoo = odoo.applicants.filter((a) => a.status !== "deleted").length;
  const hired = odoo.applicants.filter((a) => a.status === "hired").length;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm" data-odoo-campaign>
      <span className="font-semibold text-ink">Odoo</span>
      {odoo.loading && !odoo.link ? (
        <span className="text-muted">Loading…</span>
      ) : odoo.link ? (
        <>
          <span className="min-w-0 text-ink-soft">
            Job position{" "}
            {odoo.link.url ? (
              <a href={odoo.link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-electric hover:underline">
                {odoo.link.jobName ?? `#${odoo.link.jobId}`}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : (
              <span className="font-semibold">{odoo.link.jobName}</span>
            )}
          </span>
          <Badge tone={inOdoo > 0 ? "electric" : "neutral"} size="sm">
            {inOdoo} in Odoo
          </Badge>
          {hired > 0 && (
            <Badge tone="success" size="sm">
              {hired} hired
            </Badge>
          )}
        </>
      ) : (
        <span className="text-muted">Not linked to an Odoo job position yet: link it to send candidates to Odoo.</span>
      )}
      {odoo.error && <span className="text-xs text-danger">{odoo.error}</span>}
      <span className="ml-auto flex flex-wrap gap-2">
        {odoo.link && (
          <Button variant="subtle" size="sm" leftIcon={<RefreshCw className="h-4 w-4" />} loading={odoo.loading} onClick={odoo.refresh}>
            Sync from Odoo
          </Button>
        )}
        {canSource && (
          <Button variant={odoo.link ? "ghost" : "outline"} size="sm" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => setPicking(true)}>
            {odoo.link ? "Change job" : "Link to an Odoo job"}
          </Button>
        )}
      </span>
      <OdooJobPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(job) => link(job.id)}
        busy={linking}
        title="Link this campaign to an Odoo job position"
        description="Candidates you send to Odoo from this campaign become applicants on this job. Candidates already in Odoo stay where they are."
        confirmLabel="Link"
      />
    </div>
  );
}
