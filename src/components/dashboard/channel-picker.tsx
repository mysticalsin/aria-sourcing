"use client";

import * as React from "react";
import { Button, Card, Eyebrow } from "@/components/ui";
import { CHANNEL_CATALOG, defaultChannelId, type ChannelId, type ChannelOption } from "@/lib/channel-catalog";
import { cn } from "@/lib/utils";

/** Channel choice. Off channels stay disabled. Nothing here sends a message. */
export function ChannelPicker({
  channels = CHANNEL_CATALOG,
  selectedId,
  onSelect,
  onMarkSent,
}: {
  channels?: readonly ChannelOption[];
  selectedId?: ChannelId;
  onSelect?: (id: ChannelId) => void;
  onMarkSent?: () => void;
}) {
  const group = React.useId();
  const chosen = selectedId ?? defaultChannelId(channels);
  const selected = channels.find((channel) => channel.id === chosen);
  return (
    <Card className="p-5">
      <Eyebrow>Channel</Eyebrow>
      <div className="mt-3 grid gap-3" role="radiogroup" aria-label="Outreach channel">
        {channels.map((channel) => {
          const on = channel.flag === "on";
          const checked = channel.id === chosen;
          return (
            <div
              key={channel.id}
              data-channel={channel.id}
              data-flag={channel.flag}
              className={cn(
                "rounded-2xl border px-3 py-3",
                checked ? "border-tangerine bg-tangerine-soft/40" : "border-line bg-canvas",
              )}
            >
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name={group}
                  value={channel.id}
                  checked={checked}
                  disabled={!on}
                  onChange={() => {
                    if (on) onSelect?.(channel.id);
                  }}
                  className="mt-1 accent-tangerine"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink">{channel.label}</span>
                  <span className="mt-1 block text-xs font-semibold text-ink">
                    {on ? "On" : "Off"}
                    {channel.adminOnly ? " · Admin only" : ""}
                  </span>
                </span>
              </label>
              <p className="mt-2 text-xs leading-relaxed text-muted">Cap {channel.cap}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{channel.safeguard}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink">{channel.risk}</p>
            </div>
          );
        })}
      </div>
      {selected?.markSent && (
        <div className="mt-4">
          <Button type="button" size="sm" variant="outline" onClick={() => onMarkSent?.()} disabled={!onMarkSent}>
            Mark sent
          </Button>
        </div>
      )}
    </Card>
  );
}
