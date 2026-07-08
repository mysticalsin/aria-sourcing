"use client";

import { ShieldCheck } from "lucide-react";
import { Badge, SkeletonCard } from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { RoiCalculator } from "@/components/trust/roi-calculator";
import { CompliancePosture } from "@/components/trust/compliance-posture";
import { useHydrated } from "@/lib/store";

/* ============================================================================
   4.3 Trust & ROI Proof Center — the page a buyer signs on.

   Read-only, derived-only: a buyer-editable ROI calculator computes savings
   and a multiple LIVE from real store counts x editable assumptions, and a
   compliance-posture panel surfaces real adherence signals (PII reveal
   audit, suppression checks, rate-limit enforcement, data-rights honoring)
   with deep links into the Sessions audit trail. Nothing here writes to the
   store or sends anything.
   ========================================================================== */

export default function TrustPage() {
  const hydrated = useHydrated();

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Trust & ROI"
        title="Trust & ROI Proof Center"
        description="A falsifiable ROI case and a real compliance posture: every number below is either an auditable count from this workspace or an assumption you can edit yourself."
        actions={
          <Badge tone="warning" size="md" dot>
            Illustrative, computed on synthetic demo data
          </Badge>
        }
      />
      <HydrationGate
        hydrated={hydrated}
        fallback={
          <div className="space-y-6">
            <SkeletonCard className="h-[420px]" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SkeletonCard className="h-44" />
              <SkeletonCard className="h-44" />
              <SkeletonCard className="h-44" />
              <SkeletonCard className="h-44" />
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-8">
          <RoiCalculator />
          <div>
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted" aria-hidden />
              <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-ink-soft">Compliance posture</h2>
            </div>
            <CompliancePosture />
          </div>
        </div>
      </HydrationGate>
    </div>
  );
}
