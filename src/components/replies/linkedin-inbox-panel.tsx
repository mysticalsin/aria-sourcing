"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Badge, Button, useToast } from "@/components/ui";
import { ConnectionListItem } from "@/components/settings/integration-connection-primitives";
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

function profileDisplay(url: string): string {
  try {
    const slug = url.split("/in/")[1]?.replace(/\/$/, "") ?? url;
    return slug.replace(/-/g, " ");
  } catch {
    return url;
  }
}

export function LinkedInInboxPanel({
  embedded,
  repliesOnlyDefault = false,
}: {
  embedded?: boolean;
  repliesOnlyDefault?: boolean;
}) {
  const { toast } = useToast();
  const [repliesOnly, setRepliesOnly] = React.useState(repliesOnlyDefault);
  const demoEvents = React.useSyncExternalStore(
    subscribeLinkedInDemoEvents,
    getLinkedInDemoEventsSnapshot,
    () => [] as LinkedInDemoChannelEvent[],
  );
  const [liveEvents, setLiveEvents] = React.useState<ChannelEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
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
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const events: ChannelEvent[] = !supabaseEnabled ? demoEvents.map(asChannelEvent) : liveEvents;
  const visible = repliesOnly ? events.filter((ev) => ev.event_type === "reply") : events;

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold tracking-tight text-ink">LinkedIn channel</p>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Vendor webhooks and admin simulates land here. Replies enqueue classify; lifecycle events
          stay in the activity stream.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRepliesOnly((v) => !v)}
          className="rounded-full bg-canvas px-3 py-1 text-xs font-medium text-muted hover:text-ink"
        >
          {repliesOnly ? "Replies only" : "All events"}
        </button>
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
    </div>
  );

  const list = loadError ? (
    <p className="text-xs text-danger">{loadError}</p>
  ) : loading && supabaseEnabled && visible.length === 0 ? (
    <p className="text-xs text-muted">Loading LinkedIn events…</p>
  ) : visible.length === 0 ? (
    <p className="text-xs text-muted">
      No LinkedIn events yet.{" "}
      <Link href="/settings?tab=integrations#linkedin-outreach-stack" className="font-medium text-ink underline-offset-2 hover:underline">
        Connect LinkedIn
      </Link>{" "}
      or simulate in Settings.
    </p>
  ) : (
    <ul className="space-y-2" aria-label="LinkedIn channel events">
      {visible.map((ev, i) => {
        const label = linkedInEventLabel((ev.event_type as LinkedInEventType) || "reply");
        const isReply = ev.event_type === "reply";
        const healthy = Boolean(ev.candidate_id);
        return (
          <motion.li
            key={ev.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.03 }}
          >
            <ConnectionListItem
              title={isReply ? profileDisplay(ev.profile_url) : label}
              meta={`${label} · ${new Date(ev.occurred_at).toLocaleString()}${isReply && ev.body ? ` · ${ev.body.slice(0, 80)}` : ""}`}
              healthy={healthy || !isReply}
              badges={
                <>
                  <Linkedin className="h-3.5 w-3.5 text-[#0A66C2]" aria-hidden />
                  {isReply && !ev.candidate_id ? (
                    <Badge tone="warning" size="sm">
                      triage
                    </Badge>
                  ) : ev.candidate_id ? (
                    <Badge tone="success" size="sm">
                      linked
                    </Badge>
                  ) : null}
                </>
              }
            />
          </motion.li>
        );
      })}
    </ul>
  );

  if (embedded) {
    return (
      <div className="space-y-4">
        {header}
        {list}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line/80 bg-surface p-5 shadow-sm">
      {header}
      <div className="mt-4">{list}</div>
    </div>
  );
}
