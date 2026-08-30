"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui";
import {
  ConnectionStackShell,
  HealthStrip,
} from "@/components/settings/integration-connection-primitives";
import { fadeUp } from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";
import type { ReplyChannelFilter, ReplyStatusFilter } from "@/lib/reply-intents";
import { Settings2 } from "lucide-react";

export const REPLIES_INBOX_ID = "replies-inbox";

const STATUS_OPTIONS: { id: ReplyStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_action", label: "Needs action" },
  { id: "sla", label: "SLA" },
  { id: "handled", label: "Handled" },
];

const CHANNEL_OPTIONS: { id: ReplyChannelFilter; label: string }[] = [
  { id: "all", label: "All channels" },
  { id: "Email", label: "Email" },
  { id: "LinkedIn", label: "LinkedIn" },
  { id: "WhatsApp", label: "WhatsApp" },
];

export function RepliesInboxShell({
  total,
  hotPending,
  negative,
  unhandled,
  slaCount,
  statusFilter,
  channelFilter,
  onStatusFilter,
  onChannelFilter,
  syncAction,
  children,
}: {
  total: number;
  hotPending: number;
  negative: number;
  unhandled: number;
  slaCount: number;
  statusFilter: ReplyStatusFilter;
  channelFilter: ReplyChannelFilter;
  onStatusFilter: (f: ReplyStatusFilter) => void;
  onChannelFilter: (f: ReplyChannelFilter) => void;
  syncAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const triaged = total - unhandled;
  const progressPct = total ? (triaged / total) * 100 : 0;

  let statusLabel = "Waiting for replies";
  let statusTone: "neutral" | "success" | "electric" | "warning" | "danger" = "neutral";
  if (slaCount > 0) {
    statusLabel = `${slaCount} SLA critical`;
    statusTone = "danger";
  } else if (hotPending > 0) {
    statusLabel = `${hotPending} hot pending`;
    statusTone = "warning";
  } else if (unhandled === 0 && total > 0) {
    statusLabel = "Inbox clear";
    statusTone = "success";
  } else if (total > 0) {
    statusLabel = `${unhandled} need triage`;
    statusTone = "electric";
  }

  return (
    <motion.div variants={fadeUp} initial={reducedMotion ? false : "hidden"} animate="show">
      <ConnectionStackShell
        id={REPLIES_INBOX_ID}
        eyebrow="Inbound triage"
        title="Reply inbox"
        description="Classify intent, honour SLAs, and respond fast. Hot replies surface first; drafts never send automatically."
        statusLabel={statusLabel}
        statusTone={statusTone}
        progressPct={progressPct}
        progressLabel={`${triaged} of ${total} triaged`}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Webhook-first when configured. Manual sync is a fallback only.
            </p>
            <Link
              href="/settings?tab=integrations"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              <Settings2 className="h-3 w-3" aria-hidden />
              Connection settings
            </Link>
          </div>
        }
      >
        <div className="space-y-4 px-6 py-5 sm:px-8">
          <HealthStrip
            title="Triage health"
            primary={`${hotPending} hot · ${unhandled} unhandled`}
            secondary={negative > 0 ? `${negative} negative escalations` : undefined}
            numerator={triaged}
            denominator={total || 1}
            progressPct={progressPct}
            tone={slaCount > 0 ? "danger" : hotPending > 0 ? "warning" : total > 0 ? "success" : "neutral"}
            ariaLabel={`${triaged} of ${total} replies triaged`}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Reply status">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === opt.id}
                  onClick={() => onStatusFilter(opt.id)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    statusFilter === opt.id
                      ? "bg-ink text-surface"
                      : "bg-canvas text-muted hover:text-ink",
                  )}
                >
                  {opt.label}
                  {opt.id === "sla" && slaCount > 0 ? (
                    <Badge tone="tangerine" size="sm" className="ml-1.5">
                      {slaCount}
                    </Badge>
                  ) : null}
                </button>
              ))}
            </div>
            {syncAction}
          </div>

          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Reply channel">
            {CHANNEL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={channelFilter === opt.id}
                onClick={() => onChannelFilter(opt.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  channelFilter === opt.id
                    ? "border-ink/20 bg-surface text-ink"
                    : "border-transparent bg-canvas/60 text-muted hover:text-ink",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-line/50">{children}</div>
      </ConnectionStackShell>
    </motion.div>
  );
}
