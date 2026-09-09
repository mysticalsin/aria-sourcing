"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardHeader, CardBody, CardTitle, Eyebrow, Badge, EmptyState } from "@/components/ui";
import { useRecommendations } from "@/lib/store";
import { cn, pluralize, type Tone } from "@/lib/utils";
import {
  deriveComputerHelpRecommendations,
  type Recommendation,
  type RecommendationKind,
} from "@/lib/recommendations";
import {
  ShieldCheck,
  Flame,
  CalendarClock,
  ChevronRight,
  CheckCircle2,
  Repeat,
  Hourglass,
  UserSearch,
  Monitor,
} from "lucide-react";

const TONE_TILE: Record<Tone, string> = {
  neutral: "bg-ink/[0.06] text-ink-soft",
  tangerine: "bg-tangerine-soft text-tangerine",
  electric: "bg-electric-soft text-electric",
  aqua: "bg-aqua-soft text-aqua",
  violet: "bg-violet-soft text-violet",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-[hsl(32_90%_34%)]",
  danger: "bg-danger-soft text-danger",
};

const KIND_ICON: Record<RecommendationKind, React.ReactNode> = {
  approve_outreach: <ShieldCheck className="h-4 w-4" aria-hidden />,
  hot_reply: <Flame className="h-4 w-4" aria-hidden />,
  book_interview: <CalendarClock className="h-4 w-4" aria-hidden />,
  follow_up_due: <Repeat className="h-4 w-4" aria-hidden />,
  stalled_draft: <Hourglass className="h-4 w-4" aria-hidden />,
  source_campaign: <UserSearch className="h-4 w-4" aria-hidden />,
  computer_help: <Monitor className="h-4 w-4" aria-hidden />,
};

/**
 * The single prioritized recommendation queue -- ranked (SLA risk, then match
 * score, then stage leverage), capped, and rolled-up so it can't become a
 * notification firehose. Replaces the old fixed three-category count rows;
 * the topbar bell reads the same derived list (see useRecommendations).
 *
 * Computer help_requested items are fetched client-side from Fleet and prepended
 * so auth walls always surface without invading deriveRecommendations callers.
 */
export function AttentionPanel() {
  const recommendations = useRecommendations();
  const [helpItems, setHelpItems] = React.useState<Recommendation[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/fleet/computers", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          computers?: Array<{
            computerId: string;
            seatId?: string | null;
            seatName?: string | null;
            status?: string | null;
            campaignId?: string | null;
            lastError?: string | null;
          }>;
        };
        if (cancelled) return;
        setHelpItems(deriveComputerHelpRecommendations(data.computers ?? []));
      } catch {
        /* fleet unavailable — leave help items empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const merged = React.useMemo(() => {
    const ids = new Set(helpItems.map((h) => h.id));
    return [...helpItems, ...recommendations.filter((r) => !ids.has(r.id))];
  }, [helpItems, recommendations]);

  const total = merged.reduce((sum, r) => sum + r.count, 0);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <div>
          <Eyebrow>Priority queue</Eyebrow>
          <CardTitle className="mt-1">Recommended next actions</CardTitle>
        </div>
        {total > 0 && (
          <Badge tone="warning" dot>
            {pluralize(total, "item")}
          </Badge>
        )}
      </CardHeader>

      <CardBody className="pt-0">
        {merged.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6 text-success" aria-hidden />}
            title="All clear"
            description="No approvals, hot replies, pending bookings, overdue follow-ups, stalled drafts, sourcing gaps, or computers needing help right now. The pipeline is flowing."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {merged.map((rec) => (
              <li key={rec.id}>
                <Link
                  href={rec.href}
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-canvas/40 p-3 transition-all duration-150 hover:border-ink/15 hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      TONE_TILE[rec.tone],
                    )}
                    aria-hidden
                  >
                    {KIND_ICON[rec.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {rec.title}
                    </span>
                    {rec.why && <span className="block truncate text-xs text-muted">{rec.why}</span>}
                  </span>
                  {rec.count > 1 && (
                    <Badge tone={rec.tone} size="sm">
                      {rec.count}
                    </Badge>
                  )}
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
