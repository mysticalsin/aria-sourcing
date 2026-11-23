"use client";

import * as React from "react";
import { ExternalLink, Send } from "lucide-react";
import { Button, useConfirm, useToast } from "@/components/ui";
import { can } from "@/lib/rbac";
import { useRole } from "@/lib/store";
import { jsonBody, odooApi, STATUS_LABEL } from "./api";
import { notifyOdooChanged, useOdooCampaign, useOdooConnected } from "./use-odoo";

type HandoffAnswer = {
  status: "created" | "linked_existing" | "already_in_odoo";
  applicant: { id: number; url: string | null; stage: string | null; status: string | null };
  warning?: string;
};

/**
 * Candidate drawer: hand the candidate off to Odoo Recruitment (one click, one
 * confirmation), or show where they stand in Odoo once handed off. Renders
 * nothing while Odoo is not connected or the profile is masked.
 */
export function CandidateOdooAction({
  candidateId,
  campaignId,
  name,
  hidden,
  blocked,
}: {
  candidateId: string;
  campaignId: string;
  name: string;
  hidden: boolean;
  blocked: string | null;
}) {
  const connected = useOdooConnected();
  const role = useRole();
  const { toast } = useToast();
  const confirm = useConfirm();
  const odoo = useOdooCampaign(campaignId, connected && !hidden);
  const [sending, setSending] = React.useState(false);

  if (!connected || hidden) return null;
  const applicant = odoo.applicants.find((a) => a.candidateId === candidateId && a.status !== "deleted");

  if (applicant) {
    return (
      <a
        href={applicant.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full bg-electric-soft/60 px-3 py-1.5 text-xs font-semibold text-electric hover:bg-electric-soft"
        title="Open the application in Odoo"
        data-odoo-applicant
      >
        In Odoo: {applicant.stage ?? "application"} · {STATUS_LABEL[applicant.status]}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    );
  }
  if (odoo.loading || !can(role, "source")) return null;
  if (!odoo.link) {
    return <p className="max-w-[220px] text-xs text-muted sm:text-right">Link the campaign to an Odoo job to send candidates to Odoo.</p>;
  }

  async function send() {
    if (!odoo.link) return;
    const ok = await confirm({
      title: `Send ${name} to Odoo?`,
      description: `ARIA creates an applicant on “${odoo.link.jobName ?? "the linked job"}” in Odoo Recruitment, with ARIA's score and evidence as an internal note (no email is sent). Odoo then owns the hiring steps; their outcome comes back here.`,
      confirmLabel: "Send to Odoo",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setSending(true);
    const res = await odooApi<HandoffAnswer>("/applicants", jsonBody("POST", { candidateId }));
    setSending(false);
    if (!res.ok) {
      toast({ title: "Not sent to Odoo", description: res.error, variant: res.code === "in_flight" ? "warning" : "error" });
      return;
    }
    notifyOdooChanged();
    const verb = res.data.status === "created" ? "created" : res.data.status === "linked_existing" ? "linked (it was already in Odoo)" : "already in Odoo";
    toast({
      title: `Applicant ${verb}`,
      description: res.data.warning ?? `Odoo applicant #${res.data.applicant.id}${res.data.applicant.stage ? `, stage ${res.data.applicant.stage}` : ""}.`,
      variant: res.data.warning ? "warning" : "success",
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={<Send className="h-4 w-4" />}
      loading={sending}
      disabled={Boolean(blocked)}
      title={blocked ?? "Create the applicant in Odoo Recruitment"}
      onClick={() => void send()}
      data-odoo-send
    >
      Send to Odoo
    </Button>
  );
}
