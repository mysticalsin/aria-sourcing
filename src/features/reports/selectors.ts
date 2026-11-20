import type { SkillUpdate, WeeklyReport } from "@/lib/types";

export interface ReportsView {
  reports: WeeklyReport[];
  forCampaign(campaignId: string): WeeklyReport | undefined;
}

export function readReports(reports: WeeklyReport[]): ReportsView {
  return {
    reports,
    forCampaign(campaignId: string) {
      return reports.find((report) => report.campaignId === campaignId);
    },
  };
}

/** Selected campaign, else the active one, else the first campaign in the list. */
export function effectiveReportCampaignId(
  selectedId: string,
  activeId: string | null | undefined,
  campaigns: readonly { id: string }[],
): string {
  return selectedId || activeId || campaigns[0]?.id || "";
}

/** Proposals first, then newest. Matches the reports page ordering. */
export function sortSkillUpdates<T extends Pick<SkillUpdate, "status" | "createdAt">>(
  updates: readonly T[],
): T[] {
  return [...updates].sort((a, b) => {
    if (a.status === "proposed" && b.status !== "proposed") return -1;
    if (a.status !== "proposed" && b.status === "proposed") return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
