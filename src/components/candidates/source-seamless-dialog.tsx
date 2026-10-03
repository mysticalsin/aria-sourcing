"use client";

import * as React from "react";
import { Button, Field, Input, Modal, useToast } from "@/components/ui";
import { useActions, useApiKeys, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { experimentalPaidSourcingEnabled } from "@/lib/supabase/config";
import { Search } from "lucide-react";

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Seamless.AI real-people search — the fifth real sourcing channel alongside
 * GitHub/web search, Sillage account mapping, and Apollo: the operator sets
 * optional filters (title, seniority, department, industry, location,
 * company) and gets back real, named profiles that land directly as scored
 * candidates. Search itself returns no email/phone — revealing contact
 * details is a separate, explicitly confirmed per-candidate action from the
 * candidate drawer (async: research → poll). Gated behind the same "source"
 * permission as the other sourcing buttons, and only rendered once a
 * Seamless key is connected (Settings → API Keys).
 */
export function SourceSeamlessButton({ campaignId, disabled }: { campaignId: string; disabled?: boolean }) {
  const actions = useActions();
  const role = useRole();
  const apiKeys = useApiKeys();
  const { toast } = useToast();
  const idBase = React.useId();

  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [jobTitles, setJobTitles] = React.useState("");
  const [seniorities, setSeniorities] = React.useState("");
  const [departments, setDepartments] = React.useState("");
  const [industries, setIndustries] = React.useState("");
  const [countries, setCountries] = React.useState("");
  const [companyDomains, setCompanyDomains] = React.useState("");

  if (!experimentalPaidSourcingEnabled || !can(role, "source")) return null;
  if (!apiKeys.some((k) => k.provider === "Seamless")) return null;

  function resetAndClose() {
    setBusy(false);
    setOpen(false);
  }

  async function handleSubmit() {
    setBusy(true);
    const res = await actions.sourceFromSeamless(campaignId, {
      jobTitles: splitList(jobTitles),
      seniorities: splitList(seniorities),
      departments: splitList(departments),
      industries: splitList(industries),
      countries: splitList(countries),
      companyDomains: splitList(companyDomains),
    });
    setBusy(false);
    if (res.source === "seamless") {
      resetAndClose();
      toast({
        title: `Sourced ${res.accepted.length} candidate${res.accepted.length === 1 ? "" : "s"} via Seamless`,
        description: res.skipped.length
          ? `${res.skipped.length} skipped by dedupe and exclusion rules.`
          : "Live results from Seamless.",
        variant: "success",
      });
      return;
    }
    toast({
      title: res.source === "not_configured" ? "Seamless isn't connected" : "Seamless search failed",
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
        title={disabled ? "Resume the campaign to source via Seamless" : undefined}
      >
        Source via Seamless
      </Button>
      <Modal
        open={open}
        onClose={resetAndClose}
        title="Source via Seamless"
        description="Results land directly as candidates; reveal contact details per-candidate afterward from the candidate drawer."
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
              Search Seamless
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job titles" htmlFor={`${idBase}-titles`} hint="Comma-separated" className="sm:col-span-2">
            <Input
              id={`${idBase}-titles`}
              value={jobTitles}
              onChange={(e) => setJobTitles(e.target.value)}
              placeholder="e.g. Staff Engineer, Engineering Manager"
            />
          </Field>
          <Field label="Seniority" htmlFor={`${idBase}-seniority`} hint="Comma-separated">
            <Input
              id={`${idBase}-seniority`}
              value={seniorities}
              onChange={(e) => setSeniorities(e.target.value)}
              placeholder="e.g. Senior, Director"
            />
          </Field>
          <Field label="Department" htmlFor={`${idBase}-department`} hint="Comma-separated">
            <Input
              id={`${idBase}-department`}
              value={departments}
              onChange={(e) => setDepartments(e.target.value)}
              placeholder="e.g. Engineering, IT"
            />
          </Field>
          <Field label="Industry" htmlFor={`${idBase}-industry`} hint="Comma-separated">
            <Input
              id={`${idBase}-industry`}
              value={industries}
              onChange={(e) => setIndustries(e.target.value)}
              placeholder="e.g. Computer Software"
            />
          </Field>
          <Field label="Country" htmlFor={`${idBase}-country`} hint="Comma-separated">
            <Input
              id={`${idBase}-country`}
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
              placeholder="e.g. United States"
            />
          </Field>
          <Field label="Company domains" htmlFor={`${idBase}-domains`} hint="Comma-separated" className="sm:col-span-2">
            <Input
              id={`${idBase}-domains`}
              value={companyDomains}
              onChange={(e) => setCompanyDomains(e.target.value)}
              placeholder="e.g. stripe.com, figma.com"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
