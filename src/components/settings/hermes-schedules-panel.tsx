"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow } from "@/components/ui";
import { useSettings } from "@/lib/store";
import { hermesRuntimeAvailable } from "@/lib/ai/hermes-runtime";
import { Server } from "lucide-react";

type CronJobRow = {
  id: string;
  path?: string;
  schedule?: string;
  description?: string;
  name?: string;
  enabled?: boolean;
};

export function HermesSchedulesPanel() {
  const settings = useSettings();
  const live = hermesRuntimeAvailable(settings);
  const [loading, setLoading] = React.useState(false);
  const [loopJobs, setLoopJobs] = React.useState<CronJobRow[]>([]);
  const [hermesJobs, setHermesJobs] = React.useState<CronJobRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!live) {
      setLoopJobs([]);
      setHermesJobs(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/cron/jobs")
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          jobs?: CronJobRow[];
          hermesJobs?: CronJobRow[] | null;
          reason?: string;
        } | null;
        if (cancelled) return;
        setLoading(false);
        if (!json?.ok) {
          setError(json?.reason ?? "Unable to load schedules.");
          return;
        }
        setError(null);
        setLoopJobs(Array.isArray(json.jobs) ? json.jobs : []);
        setHermesJobs(Array.isArray(json.hermesJobs) ? json.hermesJobs : null);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setError("Network error loading schedules.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [live]);

  if (!live) {
    return (
      <Card>
        <CardContent className="space-y-2">
          <Eyebrow className="flex items-center gap-1.5">
            <Server className="h-3 w-3" aria-hidden /> Aria schedules
          </Eyebrow>
          <p className="text-xs text-muted">
            Enable Aria live mode to see scheduled jobs defined on the hermes-agent runtime.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <Eyebrow className="flex items-center gap-1.5">
          <Server className="h-3 w-3" aria-hidden /> Aria schedules
        </Eyebrow>
        {loading ? (
          <p className="text-xs text-muted">Loading cron mirrors…</p>
        ) : error ? (
          <p className="text-xs text-muted">{error}</p>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium text-ink-soft">MSourcing loop cron routes</p>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {loopJobs.map((job) => (
                  <li key={job.id}>
                    <span className="font-medium text-ink">{job.id}</span>
                    {job.schedule ? ` · ${job.schedule}` : ""}
                    {job.description ? ` — ${job.description}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            {hermesJobs && hermesJobs.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-ink-soft">Hermes runtime cron jobs</p>
                <ul className="mt-1 space-y-1 text-xs text-muted">
                  {hermesJobs.map((job, idx) => (
                    <li key={job.id ?? job.name ?? String(idx)}>
                      <span className="font-medium text-ink">{job.name ?? job.id ?? "job"}</span>
                      {job.schedule ? ` · ${job.schedule}` : ""}
                      {job.enabled === false ? " (disabled)" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted">
                Hermes runtime cron jobs not reachable — check HERMES_WEB_URL and profile multiplexing.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
