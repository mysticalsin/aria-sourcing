"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Badge, Button, Card, CardContent, Eyebrow, useToast } from "@/components/ui";
import { linkedInEventLabel, type LinkedInEventType } from "@/lib/linkedin-events";
import {
  getLinkedInDemoEventsSnapshot,
  subscribeLinkedInDemoEvents,
  type LinkedInDemoChannelEvent,
} from "@/lib/linkedin-demo-events-store";
import { supabaseEnabled } from "@/lib/supabase/config";
import { Linkedin, RefreshCw } from "lucide-react";

type ChannelEvent = {
  id: string;
  event_id: string;
  event_type: string;
  profile_url: string;
  body: string;
  candidate_id: string | null;
  inbound_id: string | null;
  conversation_id: string | null;
  occurred_at: string;
};

function asChannelEvent(ev: LinkedInDemoChannelEvent): ChannelEvent {
  return {
    id: ev.id,
    event_id: ev.event_id,
    event_type: ev.event_type,
    profile_url: ev.profile_url,
    body: ev.body,
    candidate_id: ev.candidate_id,
    inbound_id: ev.inbound_id,
    conversation_id: ev.conversation_id,
    occurred_at: ev.occurred_at,
  };
}

/**
 * LinkedIn channel inbox — HeyReach-parity event stream (replies + lifecycle).
 * Live: Supabase linkedin_channel_events. Demo: browser-durable simulate store.
 */
export function LinkedInInboxPanel() {
  const { toast } = useToast();
  const demoEvents = React.useSyncExternalStore(
    subscribeLinkedInDemoEvents,
    getLinkedInDemoEventsSnapshot,
    () => [] as LinkedInDemoChannelEvent[],
  );
  const [liveEvents, setLiveEvents] = React.useState<ChannelEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!supabaseEnabled) {
        setLiveEvents([]);
        setLoadError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/linkedin/events?limit=40", {
          headers: { accept: "application/json" },
          credentials: "include",
          signal,
        });
        const json = (await res.json().catch(() => ({ ok: false }))) as {
          ok?: boolean;
          events?: ChannelEvent[];
          error?: string;
          demo?: boolean;
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? "Could not load LinkedIn events.");
        }
        setLiveEvents(json.events ?? []);
      } catch (error) {
        if (signal?.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Could not load LinkedIn events.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const events: ChannelEvent[] = !supabaseEnabled
    ? demoEvents.map(asChannelEvent)
    : liveEvents;

  return (
    <Card className="overflow-hidden border-sky-500/15 bg-gradient-to-br from-surface via-surface to-sky-500/[0.05]">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Eyebrow>LinkedIn</Eyebrow>
            <p className="mt-1 text-sm font-semibold text-ink">Messaging inbox</p>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              Vendor webhooks and admin simulates land here — replies enqueue classify; accepts,
              delivers, and failures stay as lifecycle events.
              {!supabaseEnabled ? " Demo events persist in this browser after Simulate." : null}
            </p>
          </div>
          <Button
            size="sm"
            variant="subtle"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            loading={loading && supabaseEnabled}
            onClick={() => {
              if (!supabaseEnabled) {
                toast({
                  title: "Demo inbox",
                  description: `${demoEvents.length} event(s) in browser store.`,
                  variant: "info",
                });
                return;
              }
              void load();
            }}
          >
            Refresh
          </Button>
        </div>

        {loadError ? (
          <p className="text-xs text-danger">{loadError}</p>
        ) : loading && supabaseEnabled && events.length === 0 ? (
          <p className="text-xs text-muted">Loading LinkedIn events…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted">
            No LinkedIn channel events yet. After a candidate answers (or you Simulate in Settings),
            events appear here.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="LinkedIn channel events">
            {events.map((ev, i) => {
              const label = linkedInEventLabel(
                (ev.event_type as LinkedInEventType) || "reply",
              );
              const isReply = ev.event_type === "reply";
              return (
                <motion.li
                  key={ev.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.03 }}
                  className="rounded-xl border border-line bg-surface/90 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Linkedin className="h-3.5 w-3.5 text-sky-600" aria-hidden />
                    <Badge tone={isReply ? "tangerine" : "neutral"} size="sm">
                      {label}
                    </Badge>
                    {ev.candidate_id ? (
                      <Badge tone="success" size="sm">
                        correlated
                      </Badge>
                    ) : isReply ? (
                      <Badge tone="warning" size="sm">
                        triage
                      </Badge>
                    ) : null}
                    <span className="text-[10px] text-muted">
                      {new Date(ev.occurred_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-muted" title={ev.profile_url}>
                    {ev.profile_url || "—"}
                  </p>
                  {isReply && ev.body ? (
                    <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{ev.body}</p>
                  ) : null}
                </motion.li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
