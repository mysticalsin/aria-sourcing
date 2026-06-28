"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, Badge, SkeletonCard } from "@/components/ui";
import { useSettings } from "@/lib/store";
import { getHermesMemory, hermesRuntimeAvailable } from "@/lib/ai/hermes-runtime";
import { Server } from "lucide-react";

export function HermesMemoryPanel() {
  const settings = useSettings();
  const live = hermesRuntimeAvailable(settings);
  const [entries, setEntries] = React.useState<unknown[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!live) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getHermesMemory(settings).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setEntries(Array.isArray(res.data) ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [live, settings]);

  if (!live) {
    return (
      <Card>
        <CardContent className="space-y-2">
          <Eyebrow className="flex items-center gap-1.5">
            <Server className="h-3 w-3" aria-hidden /> Aria memory
          </Eyebrow>
          <p className="text-xs text-muted">
            Enable Aria live mode in Settings to mirror the runtime&apos;s long-term memory here.
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
            <Server className="h-3 w-3" aria-hidden /> Aria memory
          </Eyebrow>
          <Badge tone="success" size="sm" dot>Live</Badge>
        </div>
        {loading ? (
          <SkeletonCard />
        ) : !entries || entries.length === 0 ? (
          <p className="text-xs text-muted">No entries returned from hermes-agent /api/memory.</p>
        ) : (
          <div className="space-y-2 max-h-[320px] overflow-y-auto">
            {entries.map((entry, i) => {
              const e = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
              return (
                <div key={i} className="rounded-xl border border-line bg-canvas p-2.5 text-xs">
                  <p className="font-medium text-ink">{String(e.title ?? e.key ?? e.id ?? `Entry ${i + 1}`)}</p>
                  <p className="mt-1 text-muted line-clamp-3">{String(e.content ?? e.value ?? e.text ?? JSON.stringify(entry))}</p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
