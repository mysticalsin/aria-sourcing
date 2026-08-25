"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Eyebrow,
  useToast,
} from "@/components/ui";
import type { InboundMessage } from "@/lib/email-sync";
import {
  filterOutlookNeeds,
  formatNeedAsIntakeEmail,
  seatHasOutlookMailbox,
  type OutlookNeedMessage,
} from "@/lib/outlook-needs";
import { useSeats } from "@/lib/store";
import { supabaseEnabled } from "@/lib/supabase/config";
import { cn, formatTimeAgo } from "@/lib/utils";
import { Inbox, Link2, Mail, RefreshCw, Sparkles } from "lucide-react";

type SyncJson = {
  ok?: boolean;
  status?: string;
  messages?: (InboundMessage & { seatId: string })[];
  error?: string;
  detail?: string;
};

export function OutlookNeedsPanel({
  onSelectNeed,
  selectedMessageId,
  busy,
}: {
  /** Load a need into the intake form (does not auto-create a campaign). */
  onSelectNeed: (intakeEmail: string, need: OutlookNeedMessage) => void;
  selectedMessageId?: string | null;
  busy?: boolean;
}) {
  const seats = useSeats();
  const { toast } = useToast();
  const [pulling, setPulling] = React.useState(false);
  const [needs, setNeeds] = React.useState<OutlookNeedMessage[]>([]);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [pulledOnce, setPulledOnce] = React.useState(false);

  const outlookSeats = seats.filter((s) => s.provider === "Microsoft Graph");
  const connected = outlookSeats.filter(seatHasOutlookMailbox);
  const connectSeat = outlookSeats.find((s) => !seatHasOutlookMailbox(s)) ?? outlookSeats[0];

  async function pullNeeds() {
    setPulling(true);
    setLastError(null);
    try {
      if (!supabaseEnabled) {
        setNeeds([]);
        setPulledOnce(true);
        toast({
          title: "Live Outlook required",
          description:
            "Connect a Microsoft mailbox in Agent Fleet (Supabase live mode). Demo workspaces cannot read a real inbox.",
          variant: "warning",
        });
        return;
      }
      if (connected.length === 0) {
        setNeeds([]);
        setPulledOnce(true);
        toast({
          title: "Connect Outlook first",
          description: "Link a Microsoft 365 mailbox, then pull open needs in one click.",
          variant: "warning",
        });
        return;
      }

      const res = await fetch("/api/email/sync", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
      });
      const json = (await res.json().catch(() => null)) as SyncJson | null;
      if (!res.ok || !json?.ok) {
        const err = json?.error ?? json?.detail ?? `Sync failed (${res.status})`;
        setLastError(err);
        setNeeds([]);
        toast({ title: "Could not read Outlook", description: err, variant: "error" });
        return;
      }
      if (json.status === "dry-run") {
        setNeeds([]);
        setPulledOnce(true);
        toast({
          title: "Public demo — inbox not read",
          description: json.detail ?? "Mailbox side-effects are disabled on the public demo.",
          variant: "info",
        });
        return;
      }

      const filtered = filterOutlookNeeds(json.messages ?? []);
      setNeeds(filtered);
      setPulledOnce(true);
      toast({
        title: filtered.length ? "Open needs from Outlook" : "No open needs found",
        description: filtered.length
          ? `${filtered.length} hiring-need email${filtered.length === 1 ? "" : "s"} ready to source.`
          : "Inbox synced, but nothing matched a hiring-need pattern. Try paste-to-parse below.",
        variant: filtered.length ? "success" : "info",
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : "Mailbox sync timed out.";
      setLastError(err);
      toast({ title: "Outlook pull failed", description: err, variant: "error" });
    } finally {
      setPulling(false);
    }
  }

  function selectNeed(need: OutlookNeedMessage) {
    onSelectNeed(formatNeedAsIntakeEmail(need), need);
  }

  return (
    <Card className="overflow-hidden border-electric/20 bg-gradient-to-br from-surface via-surface to-electric/[0.04]">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Eyebrow>Outlook → sourcing</Eyebrow>
            <CardTitle className="mt-1">Pull open needs</CardTitle>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              Connect Microsoft 365 once, pull hiring emails, pick a need, parse, then start sourcing —
              no copy-paste from Outlook.
            </p>
          </div>
          <Badge tone={connected.length ? "success" : "warning"} dot>
            {connected.length
              ? `${connected.length} mailbox${connected.length === 1 ? "" : "es"} linked`
              : "Outlook not connected"}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {connected.length === 0 ? (
            connectSeat && supabaseEnabled ? (
              <Button
                type="button"
                size="sm"
                leftIcon={<Link2 className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => {
                  window.location.href = `/auth/microsoft?seat_id=${encodeURIComponent(connectSeat.id)}`;
                }}
              >
                Connect Outlook
              </Button>
            ) : (
              <Link
                href="/fleet"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-canvas"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden />
                Open Agent Fleet to connect
              </Link>
            )
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={connected.length ? "primary" : "subtle"}
            leftIcon={<RefreshCw className={cn("h-3.5 w-3.5", pulling && "animate-spin")} aria-hidden />}
            onClick={() => void pullNeeds()}
            loading={pulling}
            disabled={pulling || busy}
          >
            {pulling ? "Pulling…" : "Pull open needs"}
          </Button>
          <Link
            href="/settings?tab=setup"
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-ink hover:bg-ink/5"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Setup guide
          </Link>
        </div>
        {lastError ? <p className="text-xs text-danger">{lastError}</p> : null}
      </CardHeader>

      <CardBody className="pt-0">
        <AnimatePresence mode="wait">
          {!pulledOnce ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-start gap-3 rounded-2xl border border-dashed border-line bg-ink/[0.02] p-4"
            >
              <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-electric" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-ink">One click from mailbox to campaign</p>
                <p className="mt-1 text-xs text-muted">
                  We only read the inbox (never send or delete). Matching subjects look like “new role”,
                  “JD”, “backfill”, or Mantu “need is now ACTIVE” mail.
                </p>
              </div>
            </motion.div>
          ) : needs.length === 0 ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-muted"
            >
              No hiring-need emails in the latest sync. Paste a brief below, or check another mailbox in Fleet.
            </motion.p>
          ) : (
            <motion.ul
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-2"
              role="list"
            >
              {needs.map((need, i) => {
                const selected = selectedMessageId === need.messageId;
                return (
                  <motion.li
                    key={need.messageId}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.24), type: "spring", stiffness: 380, damping: 28 }}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => selectNeed(need)}
                      className={cn(
                        "w-full rounded-2xl border p-3.5 text-left transition",
                        selected
                          ? "border-electric bg-electric/10 shadow-[0_0_0_1px_rgba(59,130,246,0.25)]"
                          : "border-line bg-surface hover:border-electric/40 hover:bg-electric/[0.04]",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{need.subject || "(no subject)"}</p>
                          <p className="mt-0.5 truncate text-xs text-muted">{need.from}</p>
                          <p className="mt-1.5 line-clamp-2 text-xs text-ink-soft">{need.preview}</p>
                          {need.receivedAt ? (
                            <p className="mt-1.5 text-[0.6875rem] text-muted">
                              {formatTimeAgo(need.receivedAt)}
                            </p>
                          ) : null}
                        </div>
                        {selected ? (
                          <Badge tone="electric" size="sm">
                            Selected
                          </Badge>
                        ) : null}
                      </div>
                    </button>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </CardBody>
    </Card>
  );
}
