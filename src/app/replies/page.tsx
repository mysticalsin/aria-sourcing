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
import { useHydrated, useReplies, useActions, useRole, useOutreach } from "@/lib/store";
import { REPLY_INTENTS, type ReplyIntent } from "@/lib/types";
import { can } from "@/lib/rbac";
import { Inbox, Flame, Filter, AlarmClock, RefreshCw, ClipboardPaste } from "lucide-react";
import type { InboundMessage } from "@/lib/email-sync";
import { runMission } from "@/lib/agents/mission";
import { inboxTriagePlan, type InboxFetchResult } from "@/lib/agents/inbox-mission";

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

// ── Inbox triage button ──────────────────────────────────────────────────────

type SyncApiResponse = {
  ok: boolean;
  status?: "dry-run";
  detail?: string;
  messages?: (InboundMessage & { seatId: string })[];
  errors?: string[];
};

async function fetchInbox(): Promise<InboxFetchResult> {
  let res: Response;
  try {
    res = await fetch("/api/email/sync", { method: "POST", signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "TimeoutError" ? "Sync timed out. Try again." : "Couldn't reach the mailbox sync.",
    );
  }
  const json = (await res.json().catch(() => ({ ok: false }))) as SyncApiResponse;
  if (!res.ok || !json.ok) throw new Error("Couldn't reach the mailbox sync.");
  // The public demo has no mailbox: triage still drafts the waiting replies.
  if (json.status === "dry-run") return { messages: [], skipped: 0, note: json.detail ?? "Public demo only." };
  return { messages: json.messages ?? [], skipped: (json.errors ?? []).length };
}

/**
 * Runs the inbox triage mission: sync the mailbox, classify each new reply
 * (Haiku, three at a time), then queue a response draft for every reply that
 * needs one. Drafts wait for approval; reply actions stay on the cards.
 */
function TriageInboxButton() {
  const actions = useActions();
  const replies = useReplies();
  const outreach = useOutreach();
  const { toast } = useToast();
  const role = useRole();
  const [running, setRunning] = React.useState(false);

  if (!can(role, "source")) return null;

  async function handleTriage() {
    setRunning(true);
    try {
      const plan = inboxTriagePlan({
        fetchInbox,
        classify: async (m) =>
          (
            await actions.classifyAndStoreReply({
              text: m.body,
              fromAddress: m.from,
              messageId: m.messageId,
              inboxThreadId: m.threadId,
              externalReceivedAt: m.receivedAt,
            })
          ).reply,
        pending: replies,
        outreach,
        draftResponse: can(role, "outreach") ? actions.draftReplyResponse : undefined,
        prepareResponse: actions.prepareReplyResponse,
      });
      const report = await runMission(plan, { concurrency: 3 });
      const fetched = report.results.fetch as InboxFetchResult | undefined;
      // The mailbox step falls back instead of failing; its note says why.
      const mailboxDown = report.steps.fetch?.status === "degraded";

      const classify = report.steps.classify;
      const respond = report.steps.respond;
      const drafted = respond ? respond.succeeded : 0;
      const parts: string[] = [];
      if (classify && classify.runs > 0) parts.push(`${classify.succeeded} synced`);
      if (classify && classify.failed > 0) parts.push(`${classify.failed} failed`);
      if (fetched && fetched.skipped > 0) parts.push(`${fetched.skipped} skipped`);
      parts.push(drafted === 1 ? "1 response drafted for approval" : `${drafted} responses drafted for approval`);
      if (respond && respond.failed > 0) parts.push(`${respond.failed} left for your review`);

      const didWork = Boolean(classify?.runs || respond?.runs);
      toast({
        title: didWork
          ? parts.join(", ") + "."
          : mailboxDown
            ? "Couldn't reach the mailbox sync."
            : "No new mail and no reply waiting for a response.",
        description: fetched?.note,
        variant: mailboxDown && !didWork ? "error" : fetched?.note ? "info" : undefined,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      loading={running}
      leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
      onClick={handleTriage}
      title="Sync the mailbox, classify new replies and draft responses for approval"
    >
      {running ? "Triaging..." : "Triage inbox"}
    </Button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RepliesPage() {
  const hydrated = useHydrated();
  const replies = useReplies();
  const [intentFilter, setIntentFilter] = React.useState<string>("all");
  const [classifierOpen, setClassifierOpen] = React.useState(false);

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
        eyebrow="Engage"
        title="Replies"
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
            <TriageInboxButton />
          </div>
        }
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <div className="space-y-6">
            <SkeletonCard />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        }
      >
        <div className="space-y-8">
          {/* Filter bar. The work queue comes first; the manual classifier
              is a tool, opened on demand. */}
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
              <Button
                variant={classifierOpen ? "subtle" : "outline"}
                size="sm"
                leftIcon={<ClipboardPaste className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => setClassifierOpen((v) => !v)}
                aria-expanded={classifierOpen}
                aria-controls="reply-classifier-panel"
              >
                {classifierOpen ? "Hide classifier" : "Paste a reply"}
              </Button>
            </div>
          </div>

          {classifierOpen && (
            <div id="reply-classifier-panel">
              <ReplyClassifier />
            </div>
          )}

          {replies.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-6 w-6" aria-hidden />}
              title="No replies yet"
              description="Once outreach lands and candidates respond, classified replies appear here. Use Paste a reply to try the triage engine."
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
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
