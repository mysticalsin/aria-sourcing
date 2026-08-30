"use client";

import * as React from "react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  Eyebrow,
} from "@/components/ui";
import {
  useApiKeys,
  useIntegrations,
  useSeats,
  useSettings,
} from "@/lib/store";
import {
  buildOutreachAccountSlots,
  outreachSendFromSummary,
  type OutreachAccountKind,
  type OutreachAccountSlot,
} from "@/lib/outreach-accounts";
import { effectiveDryRunMode } from "@/lib/outreach-send-mode";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleDashed,
  Github,
  Linkedin,
  Mail,
  Plug,
  Search,
  Sparkles,
} from "lucide-react";

const KIND_LABEL: Record<OutreachAccountKind, string> = {
  send: "Send from",
  linkedin: "LinkedIn",
  source: "Source with",
};

function SlotIcon({ slot }: { slot: OutreachAccountSlot }) {
  if (slot.id === "github") return <Github className="h-4 w-4" aria-hidden />;
  if (slot.id.includes("linkedin") || slot.kind === "linkedin")
    return <Linkedin className="h-4 w-4" aria-hidden />;
  if (slot.kind === "send") return <Mail className="h-4 w-4" aria-hidden />;
  return <Search className="h-4 w-4" aria-hidden />;
}

function AccountRow({ slot }: { slot: OutreachAccountSlot }) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border px-3.5 py-3",
        slot.connected
          ? "border-success/25 bg-success-soft/40"
          : "border-line bg-canvas/60",
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset",
          slot.connected
            ? "bg-success-soft text-success ring-success/20"
            : "bg-ink/[0.04] text-muted ring-line",
        )}
        aria-hidden
      >
        <SlotIcon slot={slot} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-ink">{slot.title}</p>
          <Badge tone={slot.connected ? "success" : "neutral"} size="sm" dot>
            {slot.connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
        {slot.account ? (
          <p className="mt-0.5 truncate text-xs font-medium text-ink-soft">{slot.account}</p>
        ) : (
          <p className="mt-0.5 text-xs text-muted">{slot.blurb}</p>
        )}
      </div>
      <Link
        href={slot.setupHref}
        className={cn(
          "inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3.5 text-sm font-semibold transition-colors",
          slot.connected
            ? "text-ink hover:bg-ink/5"
            : "border border-ink/15 bg-surface text-ink hover:bg-canvas",
        )}
      >
        {slot.setupLabel}
      </Link>
    </li>
  );
}

/**
 * Operator-facing account checklist on /outreach — answers “which account
 * am I sending / sourcing with?” without dumping Settings complexity.
 */
export function OutreachAccountsPanel() {
  const seats = useSeats();
  const integrations = useIntegrations();
  const apiKeys = useApiKeys();
  const settings = useSettings();
  const slots = React.useMemo(
    () => buildOutreachAccountSlots({ seats, integrations, apiKeys }),
    [seats, integrations, apiKeys],
  );
  const previewOnly = effectiveDryRunMode(settings.dryRunMode, seats, integrations);
  const summary = outreachSendFromSummary(slots);

  const groups: OutreachAccountKind[] = ["send", "linkedin", "source"];
  const missingSend = slots.some((s) => s.kind === "send" && !s.connected && (s.id === "outlook" || s.id === "gmail"));
  const anySendConnected = slots.some((s) => s.kind === "send" && s.connected);

  return (
    <Card className="overflow-hidden border-line/80 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <Eyebrow className="flex items-center gap-1.5">
              <Plug className="h-3.5 w-3.5" aria-hidden /> Accounts for this queue
            </Eyebrow>
            <h2 className="text-lg font-bold tracking-tight text-ink">
              Who sends — and where we source
            </h2>
            <p className="max-w-2xl text-sm text-muted">
              Connect once. Aria drafts and queues in the background; you always see which
              mailbox or LinkedIn identity will be used before you approve.
            </p>
          </div>
          <Badge tone={previewOnly ? "electric" : "success"} size="sm" dot>
            {previewOnly ? "Dry-run / preview" : "Live send ready"}
          </Badge>
        </div>

        <div
          className={cn(
            "flex items-start gap-2 rounded-2xl px-3.5 py-3 text-sm",
            summary.liveReady ? "bg-success-soft/50 text-ink-soft" : "bg-warning-soft/60 text-ink-soft",
          )}
        >
          {summary.liveReady ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          ) : (
            <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          )}
          <p>
            <span className="font-semibold text-ink">{summary.line}</span>
            {!anySendConnected && missingSend ? (
              <>
                {" "}
                <Link
                  href="/settings?tab=integrations#email-connections-panel"
                  className="font-semibold text-electric underline-offset-2 hover:underline"
                >
                  Connect Outlook
                </Link>{" "}
                to go live.
              </>
            ) : null}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {groups.map((kind) => {
            const groupSlots = slots.filter((s) => s.kind === kind);
            if (groupSlots.length === 0) return null;
            return (
              <div key={kind} className="space-y-2.5">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  {KIND_LABEL[kind]}
                </p>
                <ul className="space-y-2">
                  {groupSlots.map((slot) => (
                    <AccountRow key={slot.id} slot={slot} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="flex items-start gap-1.5 border-t border-line pt-3 text-xs text-muted">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Full setup (OAuth, keys, HeyReach) lives in{" "}
          <Link
            href="/settings?tab=integrations"
            className="font-semibold text-ink underline-offset-2 hover:underline"
          >
            Settings → Integrations
          </Link>{" "}
          and{" "}
          <Link
            href="/settings?tab=access"
            className="font-semibold text-ink underline-offset-2 hover:underline"
          >
            Access &amp; Keys
          </Link>
          . This strip only shows what this queue will use.
        </p>
      </CardContent>
    </Card>
  );
}
