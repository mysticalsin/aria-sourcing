"use client";

import * as React from "react";
import { Monitor, Eye, Hand, Unlock, RefreshCw, CircleHelp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export type FleetComputerRow = {
  computerId: string;
  seatId: string;
  seatName?: string;
  status: string;
  control: "bot" | "human";
  lastAudit: string | null;
  lastError: string | null;
  updatedAt: string;
  remoteUrl?: string | null;
};

function isAriaViewport(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("/fleet/computers/") && url.includes("/viewport");
}

/**
 * Fleet → Computers panel. Observe / Take control are CLOSED by default —
 * operators must click to open a live view (never auto-pop LinkedIn windows).
 */
export function FleetComputersPanel({
  computers,
  onRefresh,
  onTakeControl,
  onRelease,
  onObserve,
  onStart,
  observingId: observingIdProp,
  onObservingChange,
}: {
  computers: FleetComputerRow[];
  onRefresh: () => void;
  onTakeControl: (computerId: string) => void;
  onRelease: (computerId: string) => void;
  onObserve: (computerId: string) => void;
  onStart?: (computerId: string) => void;
  /** Controlled observe target (e.g. after Take control). */
  observingId?: string | null;
  onObservingChange?: (computerId: string | null) => void;
}) {
  const [observingIdInternal, setObservingIdInternal] = React.useState<string | null>(null);
  const observingId = observingIdProp !== undefined ? observingIdProp : observingIdInternal;
  const setObservingId = onObservingChange ?? setObservingIdInternal;

  return (
    <section
      className="rounded-2xl border border-line bg-surface/80"
      aria-labelledby="fleet-computers-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Fleet computers</p>
          <h2 id="fleet-computers-heading" className="mt-0.5 text-base font-semibold text-ink">
            Isolated LinkedIn computers
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            One Chromium computer per seat. Live view stays closed until you click Open view or Take
            control. While you hold control, the bot refuses actions — Release when LinkedIn login /
            2FA is done.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Refresh
        </Button>
      </div>

      {computers.length === 0 ? (
        <div className="flex items-start gap-3 px-5 py-8 text-sm text-muted">
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            No browser-computer seats yet. Add a{" "}
            <span className="font-medium text-ink">LinkedIn Browser Computer</span> seat in Settings
            → LinkedIn (or Fleet), then return here to Start / Take control.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line/60">
          {computers.map((c) => {
            const observing = observingId === c.computerId;
            const ariaViewport = isAriaViewport(c.remoteUrl);
            return (
              <li key={c.computerId} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4 shrink-0 text-electric" aria-hidden />
                      <p className="truncate text-sm font-semibold text-ink">
                        {c.seatName ?? c.seatId}
                      </p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          c.control === "human"
                            ? "bg-tangerine/15 text-tangerine"
                            : "bg-electric/10 text-electric",
                        )}
                      >
                        {c.control === "human" ? "Human control" : "Bot control"}
                      </span>
                      <span className="text-xs text-muted">{c.status}</span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted">{c.computerId}</p>
                    {c.lastAudit ? (
                      <p className="mt-1 text-xs text-muted">Last audit: {c.lastAudit}</p>
                    ) : null}
                    {c.lastError ? (
                      <p className="mt-1 text-xs text-danger">Error: {c.lastError}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(c.status === "stopped" || c.status === "error") && onStart ? (
                      <Button type="button" variant="secondary" size="sm" onClick={() => onStart(c.computerId)}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Start
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-pressed={observing}
                      onClick={() => {
                        const next = observing ? null : c.computerId;
                        setObservingId(next);
                        if (next) onObserve(c.computerId);
                      }}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {observing ? "Close view" : "Open view"}
                    </Button>
                    {c.control === "human" ? (
                      <Button type="button" variant="secondary" size="sm" onClick={() => onRelease(c.computerId)}>
                        <Unlock className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Release
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setObservingId(c.computerId);
                          onTakeControl(c.computerId);
                        }}
                      >
                        <Hand className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Take control
                      </Button>
                    )}
                  </div>
                </div>
                {observing ? (
                  <div
                    className="mt-3 space-y-3 rounded-xl border border-dashed border-line bg-ink/[0.03] px-4 py-4 text-xs text-muted"
                    role="status"
                  >
                    {c.remoteUrl ? (
                      <>
                        <p>
                          {c.control === "human" ? (
                            <span className="font-medium text-tangerine">You have control — bot paused. </span>
                          ) : null}
                          {ariaViewport
                            ? "Operator viewport is ready inside Aria (bind COMPUTER_SUPERVISOR_URL for live Chromium)."
                            : "OpenBot computer is live."}{" "}
                          <a
                            className="inline-flex items-center gap-1 font-medium text-electric underline-offset-2 hover:underline"
                            href={c.remoteUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open sandbox viewport
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        </p>
                        <div className="rounded-lg border border-line bg-surface px-4 py-3 text-left text-sm text-ink">
                          <p className="font-medium">
                            {c.control === "human"
                              ? "Complete LinkedIn login / 2FA in the sandbox, then Release."
                              : "Click Take control whenever you need to intervene — Automatic refuses sends while you hold it."}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            1 seat = 1 computer. Mutex is enforced server-side in ComputerSupervisor.
                          </p>
                        </div>
                      </>
                    ) : (
                      <p>
                        Live stream stays closed until the computer is started. Click Start or Take
                        control (binds Settings → LinkedIn OpenBot supervisor). Activity here is
                        ephemeral — durable record is audit + contact lease.
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
