export interface LaunchRoleResult {
  created: boolean;
  sourcingComplete: boolean;
}

export interface CampaignLaunchSummary {
  status: "success" | "partial" | "failed";
  requested: number;
  created: number;
  sourcingComplete: number;
  creationFailed: number;
  sourcingFailed: number;
}

export function summarizeCampaignLaunch(
  requested: number,
  results: readonly (LaunchRoleResult | null)[],
): CampaignLaunchSummary {
  const safeRequested = Number.isInteger(requested) && requested > 0
    ? requested
    : 0;
  const completed = results.filter(
    (result): result is LaunchRoleResult => result !== null,
  );
  const created = completed.filter((result) => result.created).length;
  const sourcingComplete = completed.filter(
    (result) => result.created && result.sourcingComplete,
  ).length;
  const creationFailed = Math.max(safeRequested - created, 0);
  const sourcingFailed = Math.max(created - sourcingComplete, 0);
  const success =
    safeRequested > 0 &&
    completed.length === safeRequested &&
    created === safeRequested &&
    sourcingComplete === safeRequested;

  return {
    status: success ? "success" : created > 0 ? "partial" : "failed",
    requested: safeRequested,
    created,
    sourcingComplete,
    creationFailed,
    sourcingFailed,
  };
}
