"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, Eyebrow, Badge, SkeletonCard } from "@/components/ui";
import { useSettings, useMemory } from "@/lib/store";
import { hermesRuntimeAvailable } from "@/lib/ai/hermes-runtime";
import { Server } from "lucide-react";

/** Demo-mode curator snapshot — a plausible maintenance posture derived from
 *  local memory activity, shown when the Aria runtime isn't connected so the
 *  page never dead-ends into a bare "enable live mode" stub. */
function useDemoCuratorState(): CuratorState {
  const memory = useMemory();
  const lastActivity = memory
    .map((m) => m.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    enabled: true,
    paused: false,
    interval_hours: 6,
    last_run_at: lastActivity ?? null,
    min_idle_hours: 2,
    stale_after_days: 30,
    archive_after_days: 90,
  };
}

interface CuratorState {
  enabled?: boolean;
  paused?: boolean;
  interval_hours?: number | null;
  last_run_at?: string | null;
  min_idle_hours?: number | null;
  stale_after_days?: number | null;
  archive_after_days?: number | null;
}

export function CuratorStatus() {
  const settings = useSettings();
  const live = hermesRuntimeAvailable(settings);
  const demoState = useDemoCuratorState();
  const [state, setState] = React.useState<CuratorState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!live) {
      setState(null);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    params.set("upstreamPath", "api/curator");
    if (settings.hermesApiKeyId) params.set("hermesApiKeyId", settings.hermesApiKeyId);
    fetch(`/api/hermes/proxy?${params.toString()}`)
      .then(async (res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as CuratorState | null;
        if (data) setState(data);
        else setError(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [live, settings]);

  if (!live) {
    return (
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Eyebrow className="flex items-center gap-1.5">
              <Server className="h-3 w-3" aria-hidden /> Curator
            </Eyebrow>
            <Badge tone="warning" size="sm">Demo</Badge>
          </div>
          <CuratorFields state={demoState} />
          <p className="text-xs text-muted">
            Preview only.{" "}
            <Link href="/settings?tab=ai" className="font-semibold text-ink underline-offset-2 hover:underline">
              Enable Aria live mode in Settings → AI &amp; Models
            </Link>{" "}
            to inspect the runtime&apos;s real curator state.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Eyebrow className="flex items-center gap-1.5">
            <Server className="h-3 w-3" aria-hidden /> Curator
          </Eyebrow>
          <Badge
            tone={loading ? "electric" : error || !state ? "warning" : "success"}
            size="sm"
            dot={!loading && !error && Boolean(state)}
          >
            {loading ? "Connecting" : error || !state ? "Unavailable" : "Live"}
          </Badge>
        </div>
        {loading ? (
          <SkeletonCard />
        ) : error || !state ? (
          <p className="text-xs text-muted">Could not reach the Aria runtime.</p>
        ) : (
          <CuratorFields state={state} />
        )}
      </CardContent>
    </Card>
  );
}

function CuratorFields({ state }: { state: CuratorState }) {
  return (
    <dl className="grid grid-cols-2 gap-2 text-xs">
      <div>
        <dt className="text-muted">Enabled</dt>
        <dd className="font-medium text-ink">{state.enabled ? "Yes" : "No"}</dd>
      </div>
      <div>
        <dt className="text-muted">Paused</dt>
        <dd className="font-medium text-ink">{state.paused ? "Yes" : "No"}</dd>
      </div>
      <div>
        <dt className="text-muted">Interval</dt>
        <dd className="font-medium text-ink">{state.interval_hours ?? "—"} h</dd>
      </div>
      <div>
        <dt className="text-muted">Last run</dt>
        <dd className="font-medium text-ink">{state.last_run_at ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-muted">Stale after</dt>
        <dd className="font-medium text-ink">{state.stale_after_days ?? "—"} d</dd>
      </div>
      <div>
        <dt className="text-muted">Archive after</dt>
        <dd className="font-medium text-ink">{state.archive_after_days ?? "—"} d</dd>
      </div>
    </dl>
  );
}
