"use client";

import * as React from "react";
import { Button, Field, Input, Modal, useToast } from "@/components/ui";
import { useActions, useApiKeys, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { Search } from "lucide-react";

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Apollo.io real-people search — the second real sourcing channel alongside
 * GitHub/web search and Sillage account mapping: the operator sets optional
 * filters (title, seniority, location, company domain, keywords) and gets back
 * real, named profiles that land directly as scored candidates. Free — no
 * Apollo credits spent. Contact details are NOT included at search time;
 * revealing email/phone is a separate, explicitly confirmed per-candidate
 * action (costs 1 Apollo credit) from the candidate drawer. Gated behind the
 * same "source" permission as the other sourcing buttons, and only rendered
 * once an Apollo key is connected (Settings → API Keys).
 */
export function SourceApolloButton({ campaignId, disabled }: { campaignId: string; disabled?: boolean }) {
  const actions = useActions();
  const role = useRole();
  const apiKeys = useApiKeys();
  const { toast } = useToast();
  const idBase = React.useId();

  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [titles, setTitles] = React.useState("");
  const [seniorities, setSeniorities] = React.useState("");
  const [locations, setLocations] = React.useState("");
  const [domains, setDomains] = React.useState("");
  const [keywords, setKeywords] = React.useState("");

  if (!can(role, "source")) return null;
  if (!apiKeys.some((k) => k.provider === "Apollo")) return null;

  function resetAndClose() {
    setBusy(false);
    setOpen(false);
  }

  async function handleSubmit() {
    setBusy(true);
    const res = await actions.sourceFromApollo(campaignId, {
      titles: splitList(titles),
      seniorities: splitList(seniorities),
      locations: splitList(locations),
      organizationDomains: splitList(domains),
      keywords: keywords.trim() || undefined,
    });
    setBusy(false);
    if (res.source === "apollo") {
      resetAndClose();
      toast({
        title: `Sourced ${res.accepted.length} candidate${res.accepted.length === 1 ? "" : "s"} via Apollo`,
        description: res.skipped.length
          ? `${res.skipped.length} skipped by dedupe and exclusion rules.`
          : "Live results from Apollo.",
        variant: "success",
      });
      return;
    }
    toast({
      title: res.source === "not_configured" ? "Apollo isn't connected" : "Apollo search failed",
      description: res.error,
      variant: res.source === "not_configured" ? "warning" : "error",
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        leftIcon={<Search className="h-4 w-4" />}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "Resume the campaign to source via Apollo" : undefined}
      >
        Source via Apollo
      </Button>
      <Modal
        open={open}
        onClose={resetAndClose}
        title="Source via Apollo"
        description="Free search: no Apollo credits spent. Results land directly as candidates; reveal contact details per-candidate afterward (that step costs a credit)."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="md"
              leftIcon={<Search className="h-4 w-4" />}
              onClick={handleSubmit}
              loading={busy}
              disabled={busy}
            >
              Search Apollo
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Titles" htmlFor={`${idBase}-titles`} hint="Comma-separated" className="sm:col-span-2">
            <Input
              id={`${idBase}-titles`}
              value={titles}
              onChange={(e) => setTitles(e.target.value)}
              placeholder="e.g. Staff Engineer, Engineering Manager"
            />
          </Field>
          <Field label="Seniority" htmlFor={`${idBase}-seniority`} hint="Comma-separated">
            <Input
              id={`${idBase}-seniority`}
              value={seniorities}
              onChange={(e) => setSeniorities(e.target.value)}
              placeholder="e.g. senior, director"
            />
          </Field>
          <Field label="Location" htmlFor={`${idBase}-location`} hint="Comma-separated">
            <Input
              id={`${idBase}-location`}
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
              placeholder="e.g. London, Berlin"
            />
          </Field>
          <Field label="Company domains" htmlFor={`${idBase}-domains`} hint="Comma-separated">
            <Input
              id={`${idBase}-domains`}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="e.g. stripe.com, figma.com"
            />
          </Field>
          <Field label="Keywords" htmlFor={`${idBase}-keywords`}>
            <Input
              id={`${idBase}-keywords`}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. kubernetes"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
