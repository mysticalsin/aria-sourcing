"use client";

import * as React from "react";
import { CheckCircle2, Info, X } from "lucide-react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { linkedInApi, postJson, profileHandle } from "./api";
import { Avatar } from "./avatar";
import { Composer } from "./composer";
import type { OutboxItem } from "./types";

export function NewMessage({
  initialUrl,
  candidateId,
  extensionOnline,
  nudge,
  onQueued,
  onClose,
}: {
  initialUrl: string;
  candidateId: string | null;
  extensionOnline: boolean;
  nudge: () => void;
  onQueued: (item: OutboxItem) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [url, setUrl] = React.useState(initialUrl);
  const handle = profileHandle(url);
  const invalid = url.trim().length > 0 && !handle;

  async function send(text: string) {
    const res = await linkedInApi<{ item: OutboxItem }>(
      "/api/linkedin/outbox",
      postJson({ profileUrl: url.trim(), text, ...(candidateId ? { candidateId } : {}) }),
    );
    if (!res.ok) {
      toast({ title: "Message not queued.", description: res.error, variant: "error" });
      return;
    }
    nudge();
    toast({
      title: `Message to ${handle} queued`,
      description: "The conversation opens here as soon as LinkedIn has it.",
      variant: "success",
    });
    onQueued(res.data.item);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">New LinkedIn message</p>
          <p className="text-xs text-muted">To one of your 1st-degree connections.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 p-4">
        <label htmlFor="li-profile" className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Profile URL
        </label>
        <input
          id="li-profile"
          value={url}
          autoFocus={!initialUrl}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.linkedin.com/in/jane-doe/"
          className={cn(
            "h-11 w-full rounded-xl border bg-surface px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 ease-motion-out placeholder:text-muted",
            invalid ? "border-danger/60" : "border-line focus:border-electric/40 focus:shadow-[0_0_0_4px_hsl(var(--electric)/0.08)]",
          )}
        />
        {handle && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-ink/[0.02] p-3 animate-fade-in">
            <Avatar name={handle.replace(/[-_.]+/g, " ")} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">linkedin.com/in/{handle}</p>
              <p className="text-xs text-muted">ARIA looks the profile up through the extension, then sends.</p>
            </div>
            <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
          </div>
        )}
        {invalid && <p className="text-xs text-danger">Use a profile URL like https://www.linkedin.com/in/jane-doe/</p>}
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          LinkedIn refuses messages to people outside your network (that needs InMail or a connection request); the reason then shows on the message.
        </p>
      </div>
      <div className="min-h-0 flex-1" />
      <Composer
        placeholder={handle ? `Message ${handle}…` : "Write your message…"}
        disabled={!handle}
        onSend={send}
        hint={extensionOnline ? "Leaves from your LinkedIn account within seconds." : "The extension is offline: the message leaves as soon as Chrome is back."}
      />
    </div>
  );
}
