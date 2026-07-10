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
import { useHydrated, useReplies, useActions, useRole } from "@/lib/store";
import { REPLY_INTENTS, type ReplyIntent } from "@/lib/types";
import { can } from "@/lib/rbac";
import { Inbox, Flame, Filter, AlarmClock, RefreshCw } from "lucide-react";
import type { InboundMessage } from "@/lib/email-sync";

const INTENT_LABELS: Record<ReplyIntent, string> = {
  INTERESTED: "Interested",
  QUALIFIED_INTEREST: "Qualified interest",
  NOT_INTERESTED: "Not interested",
  REFERRAL: "Referral",
  OOO: "Out of office",
  UNCLEAR: "Unclear",
  NEGATIVE: "Negative",
};

const HOT_INTENTS: ReplyIntent[] = ["INTERESTED", "QUALIFIED_INTEREST"];

// ── Inbox sync button ────────────────────────────────────────────────────────

type SyncApiResponse = {
  ok: boolean;
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
          // One bad message doesn't abort the rest.
          clientFailed++;
        }
      }

      const synced = msgs.length - clientFailed;
      const parts: string[] = [`${synced} synced`];
      if (clientFailed > 0) parts.push(`${clientFailed} failed`);
      if (errs.length > 0) parts.push(`${errs.length} skipped`);
      const errDetail = errs.slice(0, 2).join("; ");

      toast({
        title: parts.join(", ") + ".",
        description: errDetail || undefined,
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      toast({
        title: isTimeout
          ? "Sync timed out. Try again."
          : "Couldn't reach the mailbox sync.",
        description: isTimeout
          ? undefined
          : "Check your connection settings and try again.",
        variant: "error",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      loading={syncing}
      leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
      onClick={handleSync}
    >
      {syncing ? "Syncing..." : "Sync inbox"}
    </Button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RepliesPage() {
  const hydrated = useHydrated();
  const replies = useReplies();
  const [intentFilter, setIntentFilter] = React.useState<string>("all");

  const filtered = replies.filter(
    (r) => intentFilter === "all" || r.intent === intentFilter,
  );

  const sla = filtered
    .filter((r) => HOT_INTENTS.includes(r.intent) && !r.handled && r.slaDueAt)
    .sort(
      (a, b) =>
        new Date(a.slaDueAt as string).getTime() - new Date(b.slaDueAt as string).getTime(),
    );
  const slaIds = new Set(sla.map((r) => r.id));

  const rest = filtered
    .filter((r) => !slaIds.has(r.id))
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  const hotPending = replies.filter(
    (r) => HOT_INTENTS.includes(r.intent) && !r.handled,
  ).length;
  const negative = replies.filter((r) => r.intent === "NEGATIVE").length;

  const intentOptions = [
    { value: "all", label: "All intents" },
    ...REPLY_INTENTS.map((i) => ({ value: i, label: INTENT_LABELS[i] })),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Reply triage"
        title="Inbound replies"
        description="Classify intent, honour SLAs and respond fast. Hot replies surface first; negatives are escalated. Drafts are never sent automatically."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" dot>
              {replies.length} total
            </Badge>
            <Badge tone="tangerine" dot>
              {hotPending} hot pending
            </Badge>
            {negative > 0 && (
              <Badge tone="danger" dot>
                {negative} negative
              </Badge>
            )}
            <SyncInboxButton />
          </div>
        }
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
        <div className="space-y-8">
          <WhatsAppReviewQueue />

          {/* Classifier — full width */}
          <ReplyClassifier />

          {/* Filter bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="grid h-7 w-7 place-items-center rounded-lg bg-ink/[0.05] text-ink-soft"
                aria-hidden
              >
                <Inbox className="h-4 w-4" />
              </span>
              <h2 className="eyebrow">Reply stream</h2>
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
              title="No replies match this filter"
              description="Adjust the intent filter to see more of the stream."
            />
          ) : (
            <div className="space-y-8">
              {/* SLA-critical lane */}
              {sla.length > 0 && (
                <section className="animate-fade-in rounded-3xl border border-tangerine/25 bg-tangerine-soft/40 p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <span
                      className="grid h-7 w-7 place-items-center rounded-lg bg-tangerine text-white"
                      aria-hidden
                    >
                      <AlarmClock className="h-4 w-4" />
                    </span>
                    <h3 className="eyebrow text-tangerine">Needs response (SLA)</h3>
                    <Badge tone="tangerine" size="sm">
                      {sla.length}
                    </Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {sla.map((r) => (
                      <ReplyCard key={r.id} reply={r} />
                    ))}
                  </div>
                </section>
              )}

              {/* Everything else */}
              {rest.length > 0 && (
                <section>
                  {sla.length > 0 && (
                    <div className="mb-4 flex items-center gap-2">
                      <span
                        className="grid h-7 w-7 place-items-center rounded-lg bg-ink/[0.05] text-ink-soft"
                        aria-hidden
                      >
                        <Flame className="h-4 w-4" />
                      </span>
                      <h3 className="eyebrow">All replies</h3>
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
      </HydrationGate>
    </>
  );
}
