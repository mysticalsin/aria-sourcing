"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow } from "@/components/ui";
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
      <CardContent className="space-y-2">
        <Eyebrow className="flex items-center gap-1.5">
          <Server className="h-3 w-3" aria-hidden /> Aria schedules
        </Eyebrow>
        <p className="text-xs text-muted">
          Schedule mirroring isn&apos;t wired to the runtime yet: schedules run from the runtime itself.
        </p>
      </CardContent>
    </Card>
  );
}
