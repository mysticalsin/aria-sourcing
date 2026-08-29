"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { CampaignCard } from "@/components/campaigns/campaign-card";
import { useCampaigns, useHydrated } from "@/lib/store";
import { CAMPAIGN_STATUSES, URGENCY_LEVELS } from "@/lib/types";
import { pluralize } from "@/lib/utils";
import { FolderSearch, Plus, Search } from "lucide-react";

export default function CampaignsPage() {
  const hydrated = useHydrated();
  const campaigns = useCampaigns();
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [urgency, setUrgency] = React.useState("all");
  const [department, setDepartment] = React.useState("all");

  const departments = React.useMemo(
    () => Array.from(new Set(campaigns.map((c) => c.department))).sort(),
    [campaigns],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (urgency !== "all" && c.urgency !== urgency) return false;
      if (department !== "all" && c.department !== department) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q) ||
        c.hiringManager.toLowerCase().includes(q)
      );
    });
  }, [campaigns, query, status, urgency, department]);

  const statusOptions = [
    { value: "all", label: "All statuses" },
    ...CAMPAIGN_STATUSES.map((s) => ({
      value: s,
      label: s,
    })),
  ];
  const urgencyOptions = [
    { value: "all", label: "All urgency" },
    ...URGENCY_LEVELS.map((u) => ({ value: u, label: u })),
  ];
  const departmentOptions = [
    { value: "all", label: "All departments" },
    ...departments.map((d) => ({ value: d, label: d })),
  ];

  const filtersActive =
    query.trim() !== "" || status !== "all" || urgency !== "all" || department !== "all";

  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setUrgency("all");
    setDepartment("all");
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Recruiting operations"
        title="Campaigns"
        description="Every open role Aria is sourcing for. Track the funnel, spot the bottleneck, and act on the next best move."
        actions={
          <Button
            variant="secondary"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => router.push("/intake")}
          >
            New intake
          </Button>
        }
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <EmptyState
            title="Loading campaigns…"
            description="Campaign list appears after workspace hydrate — no placeholder cards."
          />
        }
      >
        {campaigns.length === 0 ? (
          <EmptyState
            icon={<FolderSearch className="h-6 w-6" />}
            title="No campaigns yet"
            description="Paste a hiring manager's request into intake and Aria will parse the role, build a sourcing strategy, and open a campaign."
            action={
              <Button
                variant="secondary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => router.push("/intake")}
              >
                Start a new intake
              </Button>
            }
          />
        ) : (
          <>
            <Card className="mb-6">
              <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Search" htmlFor="campaign-search">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                      aria-hidden
                    />
                    <Input
                      id="campaign-search"
                      className="pl-10"
                      placeholder="Roles, departments, managers"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </Field>
                <Field label="Status" htmlFor="campaign-status">
                  <Select
                    id="campaign-status"
                    options={statusOptions}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  />
                </Field>
                <Field label="Urgency" htmlFor="campaign-urgency">
                  <Select
                    id="campaign-urgency"
                    options={urgencyOptions}
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value)}
                  />
                </Field>
                <Field label="Department" htmlFor="campaign-department">
                  <Select
                    id="campaign-department"
                    options={departmentOptions}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  />
                </Field>
              </CardBody>
            </Card>

            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Showing{" "}
                <span className="font-semibold text-ink">{filtered.length}</span> of{" "}
                {pluralize(campaigns.length, "campaign")}
              </p>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title="No campaigns match these filters"
                description="Try a broader search or reset the filters to see every active role."
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((campaign) => (
                  <CampaignCard key={campaign.id} campaign={campaign} />
                ))}
              </div>
            )}
          </>
        )}
      </HydrationGate>
    </div>
  );
}
