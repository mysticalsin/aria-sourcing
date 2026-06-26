"use client";

import * as React from "react";
import { Card, CardContent, CardTitle, Eyebrow, Meter } from "@/components/ui";
import { useSettings } from "@/lib/store";
import type { Campaign } from "@/lib/types";
import { Gauge, ShieldCheck } from "lucide-react";

export function RateMeterPanel({ campaign }: { campaign: Campaign }) {
  const settings = useSettings();
  const { emailsSentToday, linkedinSentToday } = campaign.metrics;
  const { emailsPerDay, linkedinPerDay } = settings.rateLimits;

  return (
    <Card className="animate-fade-in">
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>Guardrails</Eyebrow>
            <CardTitle className="mt-1">Daily rate limits</CardTitle>
          </div>
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-tangerine-soft text-tangerine ring-1 ring-inset ring-tangerine/20"
            aria-hidden
          >
            <Gauge className="h-5 w-5" />
          </span>
        </div>

        <div className="space-y-4">
          <Meter label="Email" used={emailsSentToday} limit={emailsPerDay} tone="tangerine" />
          <Meter label="LinkedIn" used={linkedinSentToday} limit={linkedinPerDay} tone="electric" />
        </div>

        <p className="flex items-center gap-1.5 border-t border-line pt-4 text-xs font-medium text-muted">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Human approval. Machine speed.
        </p>
      </CardContent>
    </Card>
  );
}
