"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Select,
  EmptyState,
  SkeletonCard,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { ReplyClassifier } from "@/components/replies/reply-classifier";
import { ReplyCard } from "@/components/replies/reply-card";
import { WhatsAppReviewQueue } from "@/components/replies/whatsapp-review-queue";
import { LinkedInInboxPanel } from "@/components/replies/linkedin-inbox-panel";
import { RepliesInboxShell } from "@/components/replies/replies-inbox-shell";
import { useHydrated, useReplies, useActions, useRole } from "@/lib/store";
import { REPLY_INTENTS, type ReplyIntent } from "@/lib/types";
import { can } from "@/lib/rbac";
import {
  HOT_REPLY_INTENTS,
  REPLY_INTENT_LABELS,
  type ReplyChannelFilter,
  type ReplyStatusFilter,
} from "@/lib/reply-intents";
import { Inbox, Filter, AlarmClock, RefreshCw, ListOrdered } from "lucide-react";
import type { InboundMessage } from "@/lib/email-sync";

type SyncApiResponse = {
  ok: boolean;
  status?: "dry-run";
  detail?: string;
  messages?: (InboundMessage & { seatId: string })[];
  errors?: string[];
};

function SyncInboxButton() {
  const actions = useActions();
  const { toast } = useToast();
  const role = useRole();
  const [syncing, setSyncing] = React.useState(false);

  if (!can(role, "source")) return null;

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/email/sync", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as SyncApiResponse;

      if (!res.ok || !json.ok) {
        toast({
          title: "Couldn't reach the mailbox sync.",
          description: "Check your connection settings and try again.",
          variant: "error",
        });
        return;
      }

      if (json.status === "dry-run") {
        toast({ title: "Public demo only", description: json.detail, variant: "info" });
        return;
      }

      const msgs = json.messages ?? [];
      const errs = json.errors ?? [];

      if (msgs.length === 0 && errs.length === 0) {
        toast({ title: "No new mail to sync." });
        return;
      }

      let clientFailed = 0;
      for (const m of msgs) {
        try {
          await actions.classifyAndStoreReply({
            text: m.body,
            fromAddress: m.from,
            messageId: m.messageId,
            inboxThreadId: m.threadId,
            externalReceivedAt: m.receivedAt,
          });
        } catch {
          clientFailed++;
        }
      }

      const synced = msgs.length - clientFailed;
      const parts: string[] = [`${synced} synced`];
      if (clientFailed > 0) parts.push(`${clientFailed} failed`);
      if (errs.length > 0) parts.push(`${errs.length} skipped`);

      toast({
        title: parts.join(", ") + ".",
        description: errs.slice(0, 2).join("; ") || undefined,
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      toast({
        title: isTimeout ? "Sync timed out. Try again." : "Couldn't reach the mailbox sync.",
        variant: "error",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={syncing}
      leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
      onClick={handleSync}
    >
      {syncing ? "Syncing…" : "Sync fallback"}
    </Button>
  );
}

function filterByStatus(
  replies: ReturnType<typeof useReplies>,
  status: ReplyStatusFilter,
  slaIds: Set<string>,
) {
  switch (status) {
    case "needs_action":
      return replies.filter((r) => !r.handled && r.intent !== "OOO");
    case "sla":
      return replies.filter((r) => slaIds.has(r.id));
    case "handled":
      return replies.filter((r) => r.handled);
    default:
      return replies;
  }
}

export default function RepliesPage() {
  const hydrated = useHydrated();
  const replies = useReplies();
  const [intentFilter, setIntentFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<ReplyStatusFilter>("needs_action");
  const [channelFilter, setChannelFilter] = React.useState<ReplyChannelFilter>("all");

  const sla = replies
    .filter((r) => HOT_REPLY_INTENTS.includes(r.intent) && !r.handled && r.slaDueAt)
    .sort(
      (a, b) =>
        new Date(a.slaDueAt as string).getTime() - new Date(b.slaDueAt as string).getTime(),
    );
  const slaIds = new Set(sla.map((r) => r.id));

  const statusFiltered = filterByStatus(replies, statusFilter, slaIds);

  const channelFiltered = statusFiltered.filter(
    (r) => channelFilter === "all" || r.channel === channelFilter,
  );

  const filtered = channelFiltered.filter(
    (r) => intentFilter === "all" || r.intent === intentFilter,
  );

  const rest = filtered
    .filter((r) => !slaIds.has(r.id))
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  const slaInView = filtered.filter((r) => slaIds.has(r.id));

  const hotPending = replies.filter(
    (r) => HOT_REPLY_INTENTS.includes(r.intent) && !r.handled,
  ).length;
  const negative = replies.filter((r) => r.intent === "NEGATIVE").length;
  const unhandled = replies.filter((r) => !r.handled).length;

  const intentOptions = [
    { value: "all", label: "All intents" },
    ...REPLY_INTENTS.map((i) => ({ value: i, label: REPLY_INTENT_LABELS[i] })),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Reply triage"
        title="Inbound replies"
        description="One inbox for email, LinkedIn, and WhatsApp. Hot replies surface first; nothing sends without approval."
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <div className="space-y-6">
            <SkeletonCard />
            <div className="grid gap-4 md:grid-cols-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        }
      >
        <RepliesInboxShell
          total={replies.length}
          hotPending={hotPending}
          negative={negative}
          unhandled={unhandled}
          slaCount={sla.length}
          statusFilter={statusFilter}
          channelFilter={channelFilter}
          onStatusFilter={setStatusFilter}
          onChannelFilter={setChannelFilter}
          syncAction={<SyncInboxButton />}
        >
          <div className="px-6 py-5 sm:px-8">
            <WhatsAppReviewQueue />
          </div>

          <div className="px-6 py-5 sm:px-8">
            <LinkedInInboxPanel embedded repliesOnlyDefault />
          </div>

          <div className="px-6 py-5 sm:px-8">
            <ReplyClassifier />
          </div>

          <div className="space-y-6 px-6 py-5 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="grid h-7 w-7 place-items-center rounded-lg bg-ink/[0.05] text-ink-soft"
                  aria-hidden
                >
                  <ListOrdered className="h-4 w-4" />
                </span>
                <h2 className="text-sm font-semibold text-ink">Classified stream</h2>
                <Badge tone="neutral" size="sm">
                  {filtered.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="reply-intent-filter"
                  className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft"
                >
                  <Filter className="h-3.5 w-3.5" aria-hidden />
                  Intent
                </label>
                <Select
                  id="reply-intent-filter"
                  value={intentFilter}
                  onChange={(e) => setIntentFilter(e.target.value)}
                  options={intentOptions}
                  aria-label="Filter replies by intent"
                  className="w-52"
                />
              </div>
            </div>

            {replies.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-6 w-6" aria-hidden />}
                title="No replies yet"
                description="Once outreach lands and candidates respond, classified replies appear here. Paste a reply above to try the triage engine."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Filter className="h-6 w-6" aria-hidden />}
                title="No replies match these filters"
                description="Try a different status, channel, or intent filter."
              />
            ) : (
              <div className="space-y-8">
                {slaInView.length > 0 && (
                  <section className="rounded-3xl border border-tangerine/25 bg-tangerine-soft/40 p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <span
                        className="grid h-7 w-7 place-items-center rounded-lg bg-tangerine text-white"
                        aria-hidden
                      >
                        <AlarmClock className="h-4 w-4" />
                      </span>
                      <h3 className="text-sm font-semibold text-tangerine">Needs response (SLA)</h3>
                      <Badge tone="tangerine" size="sm">
                        {slaInView.length}
                      </Badge>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {slaInView.map((r) => (
                        <ReplyCard key={r.id} reply={r} />
                      ))}
                    </div>
                  </section>
                )}

                {rest.length > 0 && (
                  <section>
                    {slaInView.length > 0 && (
                      <div className="mb-4 flex items-center gap-2">
                        <span
                          className="grid h-7 w-7 place-items-center rounded-lg bg-ink/[0.05] text-ink-soft"
                          aria-hidden
                        >
                          <Inbox className="h-4 w-4" />
                        </span>
                        <h3 className="text-sm font-semibold text-ink-soft">More replies</h3>
                        <Badge tone="neutral" size="sm">
                          {rest.length}
                        </Badge>
                      </div>
                    )}
                    <div className="grid gap-4 md:grid-cols-2">
                      {rest.map((r) => (
                        <ReplyCard key={r.id} reply={r} />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </RepliesInboxShell>
      </HydrationGate>
    </>
  );
}
