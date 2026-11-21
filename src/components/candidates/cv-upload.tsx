"use client";

import * as React from "react";
import { Button, useToast } from "@/components/ui";
import { useActions, useCampaigns } from "@/lib/store";
import { campaignAllowsManualCandidateIntake } from "@/lib/sourcing/campaign-lifecycle";
import { FileUp } from "lucide-react";

/**
 * Hands a synthetic CV to the local ingest service. The demo does not call a
 * paid parser. A missing service stays a quiet notice.
 */
export function CvUploadButton() {
  const actions = useActions();
  const campaigns = useCampaigns();
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const campaign = campaigns.find((item) => campaignAllowsManualCandidateIntake(item.status));
    if (!campaign) {
      toast({ title: "No open campaign", description: "Create a campaign before uploading a CV.", variant: "info" });
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/ingest/cv", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; name?: string; email?: string; reason?: string } | null;
      if (!payload?.ok || !payload.name || !payload.email) {
        toast({
          title: "CV ingest is off",
          description: "The demo ingest service is not running. Nothing was added.",
          variant: "info",
        });
        return;
      }
      const added = await actions.addCandidateManual(campaign.id, {
        name: payload.name,
        email: payload.email,
        lawfulBasis: "consent",
      });
      if (!added.ok || added.added === 0) {
        toast({ title: "CV was not added", description: added.ok ? added.skipReason : added.error, variant: "info" });
        return;
      }
      toast({ title: `Added ${payload.name}`, description: "Parsed from the synthetic CV.", variant: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        aria-label="CV file"
        onChange={(event) => void onFile(event)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        leftIcon={<FileUp className="h-4 w-4" />}
        loading={busy}
        onClick={() => inputRef.current?.click()}
      >
        Upload CV
      </Button>
    </>
  );
}
