"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, Badge, SkeletonCard } from "@/components/ui";
import { useSettings } from "@/lib/store";
import { hermesRuntimeAvailable } from "@/lib/ai/hermes-runtime";
import { Server } from "lucide-react";

export function HermesSchedulesPanel() {
  const settings = useSettings();
  const live = hermesRuntimeAvailable(settings);

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
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Eyebrow className="flex items-center gap-1.5">
            <Server className="h-3 w-3" aria-hidden /> Aria schedules
          </Eyebrow>
          <Badge tone="success" size="sm" dot>Live</Badge>
        </div>
        <p className="text-xs text-muted">
          The hermes-agent runtime exposes schedules via{" "}
          <code className="rounded bg-ink/[0.06] px-1">/api/schedules</code>. When you add RSC or gateway
          credentials, Aria can execute these natively. Today MSourcing mirrors them here as a read-only bridge.
        </p>
        <SkeletonCard />
      </CardContent>
    </Card>
  );
}
