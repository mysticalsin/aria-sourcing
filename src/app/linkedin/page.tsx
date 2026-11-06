"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Bell, BellOff, Inbox, Linkedin, Loader2, PenSquare } from "lucide-react";
import { Button, Card, EmptyState, useConfirm, useToast } from "@/components/ui";
import { PageHeader } from "@/components/app/page-header";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/sound";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { linkedInApi, postJson } from "@/components/linkedin/api";
import { Avatar } from "@/components/linkedin/avatar";
import { ConnectionBar, Onboarding } from "@/components/linkedin/connection";
import { ConversationList } from "@/components/linkedin/conversation-list";
import { NewMessage } from "@/components/linkedin/new-message";
import { ThreadView } from "@/components/linkedin/thread-view";
import type { Arrival, OutboxItem, OutboxStatus } from "@/components/linkedin/types";
import { useBridgeExtension } from "@/components/linkedin/use-bridge-extension";
import { useLinkedInInbox } from "@/components/linkedin/use-linkedin-inbox";

/* Experimental LinkedIn inbox. Everything here is synced by the ARIA LinkedIn
 * Bridge extension running in the user's own browser (extensions/linkedin-bridge);
 * a message leaves only when the user clicks Send. */

const SOUND_KEY = "aria.linkedin.sound";
const EASE = [0.23, 1, 0.32, 1] as const;

function useSoundPreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    try {
      setOn(window.localStorage.getItem(SOUND_KEY) === "on");
    } catch {
      // storage unavailable: stay silent
    }
  }, []);
  const set = React.useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // not remembered, still applied for this visit
    }
  }, []);
  return [on, set];
}

const STAGE_LABEL: Partial<Record<OutboxStatus, string>> = {
  queued: "Queued",
  resolving: "Finding the profile…",
  sending: "Sending…",
  failed: "Not sent",
  unknown: "Unconfirmed: check LinkedIn",
};

export default function LinkedInPage() {
  const reduced = usePrefersReducedMotion();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [sound, setSound] = useSoundPreference();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [compose, setCompose] = React.useState<{ url: string; candidateId: string | null } | null>(null);
  const [awaitingChat, setAwaitingChat] = React.useState<string | null>(null);
  const [manualToken, setManualToken] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);

  const inbox = useLinkedInInbox({
    onArrival: (arrivals: Arrival[]) => {
      playSound("beacon", sound);
      for (const a of arrivals) {
        if (a.conversationId === selected && document.visibilityState === "visible") continue;
        toast({ title: `${a.name} replied on LinkedIn`, description: a.preview, variant: "info" });
      }
    },
    onSent: () => playSound("success", sound),
  });
  const { account, conversations, outbox, refreshAll } = inbox;
  const paired = account.kind === "ready" && account.paired;
  const extension = useBridgeExtension(paired);
  const { nudge } = extension;
  const extensionOnline = account.kind === "ready" && Boolean(account.account?.online);
  // Same count as the list shows; the account figure is only the first guess.
  const unread = conversations ? conversations.filter((c) => c.unread).length : account.kind === "ready" ? account.unread : 0;

  // Deep link from a candidate: /linkedin?to=<profile url>&candidate=<id>
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const to = params.get("to");
    if (to) setCompose({ url: to, candidateId: params.get("candidate") });
  }, []);

  // Unread count in the tab title.
  React.useEffect(() => {
    const previous = document.title;
    document.title = unread ? `(${unread}) LinkedIn · ARIA` : "LinkedIn · ARIA";
    return () => {
      document.title = previous;
    };
  }, [unread]);

  // A new chat opens by itself once LinkedIn has created it.
  React.useEffect(() => {
    if (!awaitingChat) return;
    const item = outbox.find((o) => o.id === awaitingChat);
    if (item?.status === "sent" && item.conversation_id) {
      setSelected(item.conversation_id);
      setCompose(null);
      setAwaitingChat(null);
    } else if (item && (item.status === "failed" || item.status === "cancelled")) {
      setAwaitingChat(null);
    }
  }, [outbox, awaitingChat]);

  const pendingByConversation = React.useMemo(() => {
    const map = new Map<string, OutboxStatus>();
    for (const o of outbox) {
      if (o.conversation_id && (o.status === "queued" || o.status === "resolving" || o.status === "sending")) map.set(o.conversation_id, o.status);
    }
    return map;
  }, [outbox]);
  const startingChats = outbox.filter((o) => !o.conversation_id && o.status !== "sent" && o.status !== "cancelled");

  async function connect(viaExtension: boolean) {
    setConnecting(true);
    const res = await linkedInApi<{ token: string }>("/api/linkedin/account", { method: "POST" });
    if (!res.ok) {
      setConnecting(false);
      toast({ title: "Could not create a pairing code.", description: res.error, variant: "error" });
      return;
    }
    if (viaExtension && extension.detected) {
      const answer = await extension.pair(res.data.token);
      if (answer.ok) {
        setManualToken(null);
        toast({ title: "Connected", description: "The first sync with LinkedIn is starting.", variant: "success" });
      } else {
        setManualToken(res.data.token);
        toast({ title: "The extension did not take the code.", description: answer.error ?? "Paste it in the extension instead.", variant: "warning" });
      }
    } else {
      setManualToken(res.data.token);
    }
    setConnecting(false);
    await refreshAll();
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect LinkedIn?",
      description: "The extension stops syncing and every LinkedIn conversation stored in ARIA for you is deleted.",
      confirmLabel: "Disconnect and delete",
      danger: true,
    });
    if (!ok) return;
    const res = await linkedInApi("/api/linkedin/account", { method: "DELETE" });
    if (!res.ok) return toast({ title: "Disconnect failed.", description: res.error, variant: "error" });
    setSelected(null);
    setManualToken(null);
    await refreshAll();
  }

  async function syncNow() {
    await linkedInApi("/api/linkedin/conversations", postJson({}));
    nudge();
  }

  const onQueuedNewChat = React.useCallback(
    (item: OutboxItem) => {
      setAwaitingChat(item.id);
      void refreshAll();
    },
    [refreshAll],
  );

  const header = (
    <PageHeader
      eyebrow="Engage · experimental"
      title="LinkedIn"
      description="Your LinkedIn conversations, live. Nothing leaves without your click."
      actions={
        paired ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={sound ? "Mute reply sound" : "Play a sound on new replies"}
              title={sound ? "Sound on new replies: on" : "Sound on new replies: off"}
              onClick={() => {
                setSound(!sound);
                playSound("ping", !sound);
              }}
            >
              {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="gradient"
              leftIcon={<PenSquare className="h-4 w-4" />}
              onClick={() => {
                setSelected(null);
                setCompose({ url: "", candidateId: null });
              }}
            >
              New message
            </Button>
          </>
        ) : null
      }
    />
  );

  if (account.kind === "loading") {
    return (
      <div>
        {header}
        <div className="h-[60vh] animate-pulse rounded-2xl bg-ink/[0.04]" aria-busy="true" />
      </div>
    );
  }
  if (account.kind === "disabled" || account.kind === "unavailable") {
    return (
      <div>
        {header}
        <EmptyState
          icon={<Linkedin className="h-6 w-6" />}
          title={account.kind === "disabled" ? "The LinkedIn bridge is turned off" : "The LinkedIn bridge is unavailable"}
          description={
            account.kind === "disabled"
              ? "Add LINKEDIN_BRIDGE_ENABLED=true to .env.local, restart the app (Docker: docker compose up -d app), then reload."
              : account.detail
          }
        />
      </div>
    );
  }

  return (
    <div>
      {header}
      {!paired ? (
        <>
          <Onboarding extension={extension} connecting={connecting} manualToken={manualToken} onConnect={(via) => void connect(via)} />
          <p className="mt-4 flex items-start gap-2 text-xs text-muted">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Experimental. LinkedIn&apos;s User Agreement forbids automated access: this runs on your own account, at your own risk.
          </p>
        </>
      ) : (
        <>
          <ConnectionBar
            account={account.account}
            policy={account.policy}
            unread={unread}
            extension={extension}
            transport={inbox.transport}
            manualToken={manualToken}
            onReconnect={() => void connect(true)}
            onNewCode={() => void connect(false)}
            onDisconnect={() => void disconnect()}
            onSync={() => void syncNow()}
          />

          <Card className="grid h-[calc(100vh-22.5rem)] min-h-[480px] overflow-hidden lg:grid-cols-[340px_1fr]">
            <div className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
              <AnimatePresence initial={false}>
                {startingChats.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="overflow-hidden border-b border-line bg-[#0a66c2]/[0.05]"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Avatar name={item.recipient_name ?? item.recipient_public_id ?? "?"} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{item.recipient_name ?? item.recipient_public_id}</p>
                        <p
                          className={cn(
                            "flex items-center gap-1 truncate text-xs",
                            item.status === "failed" ? "text-danger" : item.status === "unknown" ? "text-[hsl(32_90%_34%)]" : "text-[#0a66c2]",
                          )}
                          title={item.error ?? undefined}
                        >
                          {(item.status === "queued" || item.status === "resolving" || item.status === "sending") && (
                            <Loader2 className={cn("h-3 w-3 shrink-0", !reduced && "animate-spin")} aria-hidden />
                          )}
                          {STAGE_LABEL[item.status]}
                          {item.error ? ` · ${item.error}` : ""}
                        </p>
                      </div>
                      {(item.status === "failed" || item.status === "unknown" || item.status === "queued") && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-muted hover:text-ink"
                          onClick={() => void linkedInApi(`/api/linkedin/outbox?id=${item.id}`, { method: "DELETE" }).then(() => refreshAll())}
                        >
                          {item.status === "queued" ? "Withdraw" : "Dismiss"}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <ConversationList
                conversations={conversations}
                selectedId={selected}
                onSelect={(id) => {
                  setCompose(null);
                  setSelected(id);
                }}
                pending={pendingByConversation}
                highlighted={inbox.highlighted}
              />
            </div>

            <div className="min-h-0">
              {compose ? (
                <NewMessage
                  key={compose.url}
                  initialUrl={compose.url}
                  candidateId={compose.candidateId}
                  extensionOnline={extensionOnline}
                  nudge={nudge}
                  onQueued={onQueuedNewChat}
                  onClose={() => setCompose(null)}
                />
              ) : selected ? (
                <ThreadView
                  key={selected}
                  conversationId={selected}
                  tick={inbox.threadTick}
                  extensionOnline={extensionOnline}
                  syncing={Boolean(extension.status?.running)}
                  nudge={nudge}
                  onChanged={refreshAll}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
                  <span className="inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-[#0a66c2] to-violet text-white shadow-xl shadow-[#0a66c2]/25">
                    <Inbox className="h-7 w-7" aria-hidden />
                  </span>
                  <div>
                    <p className="text-lg font-bold text-ink">{conversations?.length ? "Pick a conversation" : "Your LinkedIn inbox lands here"}</p>
                    <p className="mt-1 max-w-sm text-sm text-muted">
                      {conversations?.length
                        ? "Replies show up live while this page is open. You can also start a new message to one of your connections."
                        : "The extension is syncing your most recent conversations. It takes a minute the first time."}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" leftIcon={<PenSquare className="h-4 w-4" />} onClick={() => setCompose({ url: "", candidateId: null })}>
                    New message
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
