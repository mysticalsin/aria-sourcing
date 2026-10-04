"use client";

import * as React from "react";
import { Button, Field, Input, Modal, Switch, useToast } from "@/components/ui";
import { useActions, useApiKeys, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import type { ApifyProfileSearchInput } from "@/lib/sourcing/apify";
import { Linkedin, Loader2 } from "lucide-react";

const POLL_INTERVAL_MS = 4_000;
const DEFAULT_MAX_ITEMS = 25;
const MAX_ITEMS_CEILING = 50;

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Apify (harvestapi/linkedin-profile-search) — the sixth real sourcing channel
 * alongside GitHub/web search, Sillage account mapping, Apollo, and Seamless:
 * the operator sets a LinkedIn search query and/or filters (location, current
 * title, current company) and gets back real public LinkedIn profiles, scored
 * and deduped into the campaign. This is third-party public-profile data
 * bought from a vendor API, not a first-party LinkedIn scrape (no login, no
 * cookies, no session automation — see sourcing/apify.ts). Enrichment is
 * async — this kicks off the actor run server-side and returns a runId +
 * datasetId to poll with checkApifyRun. "Full + email search" mode costs more
 * (pulls emails) and is off by default. Gated behind the same "source"
 * permission as the other sourcing buttons, and only rendered once an Apify
 * key is connected (Settings → API Keys).
 */
export function SourceApifyButton({ campaignId, disabled }: { campaignId: string; disabled?: boolean }) {
  const actions = useActions();
  const role = useRole();
  const apiKeys = useApiKeys();
  const { toast } = useToast();
  const idBase = React.useId();

  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [locations, setLocations] = React.useState("");
  const [currentJobTitles, setCurrentJobTitles] = React.useState("");
  const [currentCompanies, setCurrentCompanies] = React.useState("");
  const [firstNames, setFirstNames] = React.useState("");
  const [lastNames, setLastNames] = React.useState("");
  const [maxItems, setMaxItems] = React.useState(String(DEFAULT_MAX_ITEMS));
  const [emailSearch, setEmailSearch] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [polling, setPolling] = React.useState<{ runId: string; datasetId: string; label: string } | null>(null);
  const pollTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = React.useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Stop polling on unmount so a closed/navigated-away tab never keeps hitting
  // /api/source/apify/status in the background.
  React.useEffect(() => clearPoll, [clearPoll]);

  if (!can(role, "source")) return null;
  if (!apiKeys.some((k) => k.provider === "Apify")) return null;

  function resetAndClose() {
    clearPoll();
    setSearchQuery("");
    setLocations("");
    setCurrentJobTitles("");
    setCurrentCompanies("");
    setFirstNames("");
    setLastNames("");
    setMaxItems(String(DEFAULT_MAX_ITEMS));
    setEmailSearch(false);
    setStarting(false);
    setPolling(null);
    setOpen(false);
  }

  async function poll(runId: string, datasetId: string, query: string) {
    const res = await actions.checkApifyRun(campaignId, runId, datasetId, query);
    if (!res.ok) {
      clearPoll();
      setPolling(null);
      toast({ title: "Apify search failed", description: res.error, variant: "error" });
      return;
    }
    if (res.status === "processing") return;
    clearPoll();
    resetAndClose();
    if (res.added === 0) {
      toast({
        title: "No new candidates from Apify",
        description: "Every resolved profile already matched an existing candidate.",
        variant: "warning",
      });
      return;
    }
    toast({
      title: `Sourced ${res.added} candidate${res.added === 1 ? "" : "s"} via Apify`,
      description: "Real LinkedIn profiles resolved via Apify, scored and placed in Sourced.",
      variant: "success",
    });
  }

  async function handleSubmit() {
    const trimmedQuery = searchQuery.trim();
    const locs = splitList(locations);
    const titles = splitList(currentJobTitles);
    const companies = splitList(currentCompanies);
    const first = splitList(firstNames);
    const last = splitList(lastNames);
    if (!trimmedQuery && !locs.length && !titles.length && !companies.length && !first.length && !last.length) {
      toast({ title: "Enter a search query or at least one filter", variant: "warning" });
      return;
    }

    const parsedMaxItems = Number(maxItems);
    const criteria: ApifyProfileSearchInput = {
      maxItems:
        Number.isFinite(parsedMaxItems) && parsedMaxItems > 0
          ? Math.min(Math.round(parsedMaxItems), MAX_ITEMS_CEILING)
          : DEFAULT_MAX_ITEMS,
    };
    if (trimmedQuery) criteria.searchQuery = trimmedQuery;
    if (locs.length) criteria.locations = locs;
    if (titles.length) criteria.currentJobTitles = titles;
    if (companies.length) criteria.currentCompanies = companies;
    if (first.length) criteria.firstNames = first;
    if (last.length) criteria.lastNames = last;
    if (emailSearch) criteria.profileScraperMode = "Full + email search";

    const nameLabel = [first.join(" "), last.join(" ")].filter(Boolean).join(" ").trim();
    const label = trimmedQuery || nameLabel || [titles.join(", "), companies.join(", "), locs.join(", ")].filter(Boolean).join(" · ") || "LinkedIn search";

    setStarting(true);
    const res = await actions.startApifyRun(campaignId, criteria);
    setStarting(false);
    if (!res.ok) {
      toast({ title: "Couldn't start Apify search", description: res.error, variant: "error" });
      return;
    }
    setPolling({ runId: res.runId, datasetId: res.datasetId, label });
    pollTimer.current = setInterval(() => void poll(res.runId, res.datasetId, label), POLL_INTERVAL_MS);
  }

  return (
    <>
      <Button
        variant="secondary"
        leftIcon={<Linkedin className="h-4 w-4" />}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "Resume the campaign to source via Apify" : undefined}
      >
        Source via Apify
      </Button>
      <Modal
        open={open}
        onClose={resetAndClose}
        title="Source via Apify"
        description="Real public LinkedIn profiles via a third-party provider (Apify harvestapi). No LinkedIn login, scraping, or session automation."
        footer={
          polling ? (
            <Button variant="ghost" size="md" onClick={resetAndClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="md" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={handleSubmit}
                loading={starting}
                disabled={starting}
              >
                Start search
              </Button>
            </>
          )
        }
      >
        {polling ? (
          <div className="flex items-center gap-3 rounded-2xl bg-ink/[0.03] px-4 py-3.5 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Searching LinkedIn via Apify for {polling.label}. This can take a minute.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Search query"
              htmlFor={`${idBase}-query`}
              hint="Free-text or boolean, e.g. a title + skill combination."
              className="sm:col-span-2"
            >
              <Input
                id={`${idBase}-query`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. Staff Engineer Kubernetes"
              />
            </Field>
            <Field label="First name" htmlFor={`${idBase}-first-names`} hint="Comma-separated. Narrows to exact people.">
              <Input
                id={`${idBase}-first-names`}
                value={firstNames}
                onChange={(e) => setFirstNames(e.target.value)}
                placeholder="e.g. Tony"
              />
            </Field>
            <Field label="Last name" htmlFor={`${idBase}-last-names`} hint="Comma-separated. Pair with first name for a named lookup.">
              <Input
                id={`${idBase}-last-names`}
                value={lastNames}
                onChange={(e) => setLastNames(e.target.value)}
                placeholder="e.g. Walteur"
              />
            </Field>
            <Field label="Location" htmlFor={`${idBase}-locations`} hint="Comma-separated">
              <Input
                id={`${idBase}-locations`}
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
                placeholder="e.g. London, Berlin"
              />
            </Field>
            <Field label="Current title" htmlFor={`${idBase}-titles`} hint="Comma-separated">
              <Input
                id={`${idBase}-titles`}
                value={currentJobTitles}
                onChange={(e) => setCurrentJobTitles(e.target.value)}
                placeholder="e.g. Staff Engineer, Engineering Manager"
              />
            </Field>
            <Field label="Current company" htmlFor={`${idBase}-companies`} hint="Comma-separated">
              <Input
                id={`${idBase}-companies`}
                value={currentCompanies}
                onChange={(e) => setCurrentCompanies(e.target.value)}
                placeholder="e.g. Stripe, Figma"
              />
            </Field>
            <Field label="Max results" htmlFor={`${idBase}-max-items`} hint={`Up to ${MAX_ITEMS_CEILING} per run`}>
              <Input
                id={`${idBase}-max-items`}
                type="number"
                min={1}
                max={MAX_ITEMS_CEILING}
                value={maxItems}
                onChange={(e) => setMaxItems(e.target.value)}
              />
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 sm:col-span-2">
              <div>
                <p className="text-sm font-semibold text-ink">Full profile + email search</p>
                <p className="text-xs text-muted">Higher cost per profile. Off pulls a short profile only, no email.</p>
              </div>
              <Switch
                id={`${idBase}-email-search`}
                checked={emailSearch}
                onCheckedChange={setEmailSearch}
                label={emailSearch ? "On" : "Off"}
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
