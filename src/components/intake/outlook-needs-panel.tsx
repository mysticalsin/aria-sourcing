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
  demoOutlookNeeds,
  seatHasOutlookMailbox,
  type OutlookNeedMessage,
} from "@/lib/outlook-needs";
import { useSeats } from "@/lib/store";
import { supabaseEnabled, demoLoginEnabled } from "@/lib/supabase/config";
import { cn, formatTimeAgo } from "@/lib/utils";
import { Inbox, Link2, Mail, RefreshCw, Sparkles } from "lucide-react";

type SyncJson = {
  ok?: boolean;
  status?: string;
  messages?: (InboundMessage & { seatId: string })[];
  error?: string;
  detail?: string;
};

function allowDemoNeeds(): boolean {
  // Production Fly tenants keep demo samples off unless demo login is explicitly enabled.
  return demoLoginEnabled || !supabaseEnabled;
}

function loadDemoNeeds(
  setNeeds: (n: OutlookNeedMessage[]) => void,
  toast: ReturnType<typeof useToast>["toast"],
  reason: string,
) {
  if (!allowDemoNeeds()) {
    setNeeds([]);
    toast({
      title: "Live mailbox required",
      description: `${reason} Demo hiring emails are disabled on this tenant.`,
      variant: "warning",
    });
    return;
  }
  const demo = demoOutlookNeeds();
  setNeeds(demo);
  toast({
    title: "Demo open needs loaded",
    description: `${reason} Showing ${demo.length} labelled sample hiring emails — not a live mailbox.`,
    variant: "info",
  });
}

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
  const [demoMode, setDemoMode] = React.useState(false);
  const [graphWebhookActive, setGraphWebhookActive] = React.useState(false);
  const [inboxPollAllowed, setInboxPollAllowed] = React.useState(false);

  const outlookSeats = seats.filter((s) => s.provider === "Microsoft Graph");
  const connected = outlookSeats.filter(seatHasOutlookMailbox);
  const connectSeat = outlookSeats.find((s) => !seatHasOutlookMailbox(s)) ?? outlookSeats[0];

  React.useEffect(() => {
    // Webhook path is primary — do not auto-poll Graph on mount.
    if (supabaseEnabled && connected.length > 0) {
      setPulledOnce(true);
      setDemoMode(false);
    }
  }, [supabaseEnabled, connected.length]);

  React.useEffect(() => {
    if (!supabaseEnabled || connected.length === 0) {
      setGraphWebhookActive(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/email/connections", { credentials: "same-origin" });
        const json = (await res.json().catch(() => null)) as {
          providers?: { inboxPollAllowed?: boolean };
          connections?: Array<{
            provider?: string;
            graphSubscription?: { active?: boolean } | null;
          }>;
        } | null;
        if (cancelled) return;
        setInboxPollAllowed(json?.providers?.inboxPollAllowed === true);
        const active = (json?.connections ?? []).some(
          (c) => c.provider === "Microsoft Graph" && c.graphSubscription?.active === true,
        );
        setGraphWebhookActive(active);
      } catch {
        if (!cancelled) setGraphWebhookActive(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabaseEnabled, connected.length]);

  /** Break-glass only: Graph webhook is the production intake path. */
  async function emergencySyncNeeds() {
    setPulling(true);
    setLastError(null);
    try {
      if (!supabaseEnabled) {
        setPulledOnce(true);
        setDemoMode(true);
        loadDemoNeeds(
          setNeeds,
          toast,
          "This workspace is in local demo mode (no live Supabase).",
        );
        return;
      }
      if (connected.length === 0) {
        setPulledOnce(true);
        setDemoMode(true);
        loadDemoNeeds(
          setNeeds,
          toast,
          "No Microsoft mailbox is linked yet.",
        );
        return;
      }

      const res = await fetch("/api/email/sync", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
      });
      const json = (await res.json().catch(() => null)) as SyncJson | null;
      if (res.status === 403 && json?.status === "inbox_poll_disabled") {
        setLastError(json.error ?? "Inbox polling is disabled.");
        setPulledOnce(true);
        toast({
          title: "Inbox polling disabled",
          description: json.error ?? "Hiring needs arrive via Graph webhook.",
          variant: "warning",
        });
        return;
      }
      if (!res.ok || !json?.ok) {
        const err = json?.error ?? json?.detail ?? `Sync failed (${res.status})`;
        setLastError(err);
        setPulledOnce(true);
        toast({
          title: "Emergency sync failed",
          description: err,
          variant: "error",
        });
        return;
      }
      if (json.status === "dry-run") {
        setPulledOnce(true);
        if (allowDemoNeeds()) {
          setDemoMode(true);
          loadDemoNeeds(
            setNeeds,
            toast,
            "Public demo cannot read a real inbox.",
          );
        } else {
          setDemoMode(false);
          setNeeds([]);
          toast({
            title: "Emergency sync unavailable",
            description: "Dry-run / demo sync is disabled on this production tenant. Prefer Graph webhook intake.",
            variant: "warning",
          });
        }
        return;
      }

      const filtered = filterOutlookNeeds(json.messages ?? []);
      setNeeds(filtered);
      setDemoMode(false);
      setPulledOnce(true);
      toast({
        title: filtered.length ? "Emergency sync results" : "No open needs in emergency sync",
        description: filtered.length
          ? `${filtered.length} hiring-need email${filtered.length === 1 ? "" : "s"} (break-glass poll — prefer Graph webhook).`
          : "Prefer webhook intake. Paste a brief below if the need is not yet delivered.",
        variant: filtered.length ? "success" : "info",
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : "Mailbox sync timed out.";
      setLastError(err);
      setPulledOnce(true);
      toast({ title: "Emergency sync failed", description: err, variant: "error" });
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
            <CardTitle className="mt-1">Webhook open needs</CardTitle>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              Hiring emails arrive via Microsoft Graph push (no inbox polling). Connect Outlook once —
              Aria registers a Graph subscription and routes needs into the recruiting loop.
            </p>
          </div>
          <Badge tone={connected.length ? "success" : demoMode ? "electric" : "warning"} dot>
            {connected.length
              ? `${connected.length} mailbox${connected.length === 1 ? "" : "es"} linked`
              : demoMode
                ? "Demo open needs"
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
          {inboxPollAllowed && !graphWebhookActive ? (
            <Button
              type="button"
              size="sm"
              variant="subtle"
              leftIcon={<RefreshCw className={cn("h-3.5 w-3.5", pulling && "animate-spin")} aria-hidden />}
              onClick={() => void emergencySyncNeeds()}
              loading={pulling}
              disabled={pulling || busy}
            >
              {pulling ? "Syncing…" : "Emergency sync"}
            </Button>
          ) : null}
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
                <p className="text-sm font-semibold text-ink">Graph webhook → campaign</p>
                <p className="mt-1 text-xs text-muted">
                  Connect Outlook to register a change-notification subscription. New hiring emails
                  enqueue requisition_parse automatically. Emergency sync is break-glass only
                  (hidden unless ARIA_ALLOW_INBOX_SYNC=1, and hidden once the Graph webhook is active).
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
              Waiting for webhook-delivered needs. Paste a brief below
              {inboxPollAllowed && !graphWebhookActive
                ? ", or use Emergency sync only if Graph push is unavailable."
                : "."}
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
                        ) : need.demo ? (
                          <Badge tone="aqua" size="sm">
                            Demo
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
