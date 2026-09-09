"use client";

import * as React from "react";
import {
  Bot,
  ExternalLink,
  Eye,
  Hand,
  Monitor,
  RefreshCw,
  Unlock,
  Link2,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AgentSeat } from "@/lib/types";
import type { FleetComputerRow } from "@/components/fleet/fleet-computers-panel";

type AuditEvent = {
  id?: string;
  at: string;
  computerId: string;
  action: string;
  detail: string;
  actor: string;
};

/**
 * Per-campaign Browser Computer agents: live Chromium VMs with Observe /
 * Take control / Release — same mutex as Fleet, scoped to this campaign.
 */
export function CampaignAgentsPanel({
  campaignId,
  seats,
  onAssignSeat,
  onUnassignSeat,
}: {
  campaignId: string;
  seats: AgentSeat[];
  onAssignSeat?: (seatId: string) => void;
  onUnassignSeat?: (seatId: string) => void;
}) {
  const campaignSeats = React.useMemo(
    () =>
      seats.filter(
        (s) =>
          s.provider === "LinkedIn Browser Computer" &&
          (s.assignedCampaignIds ?? []).includes(campaignId),
      ),
    [seats, campaignId],
  );
  const availableToAttach = React.useMemo(
    () =>
      seats.filter(
        (s) =>
          s.provider === "LinkedIn Browser Computer" &&
          !(s.assignedCampaignIds ?? []).includes(campaignId),
      ),
    [seats, campaignId],
  );

  const [computers, setComputers] = React.useState<FleetComputerRow[]>([]);
  const [audits, setAudits] = React.useState<AuditEvent[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [observingId, setObservingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Ensure each campaign seat has a computer registered with the supervisor.
      for (const seat of campaignSeats) {
        const computerId = seat.computerId || seat.id;
        await fetch("/api/fleet/computers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ensure", computerId, seatId: seat.id }),
        }).catch(() => null);
      }
      const res = await fetch("/api/fleet/computers", { credentials: "same-origin" });
      if (!res.ok) {
        setError(`Fleet computers unavailable (${res.status})`);
        return;
      }
      const data = (await res.json()) as {
        computers?: FleetComputerRow[];
        recentAudits?: AuditEvent[];
      };
      const ids = new Set(
        campaignSeats.map((s) => s.computerId || s.id).filter(Boolean) as string[],
      );
      const rows = (data.computers ?? []).filter((c) => ids.has(c.computerId));
      // Merge seat names when API didn't enrich
      setComputers(
        rows.map((c) => {
          const seat = campaignSeats.find(
            (s) => s.id === c.seatId || s.computerId === c.computerId,
          );
          return seat ? { ...c, seatName: seat.name } : c;
        }),
      );
      setAudits(
        (data.recentAudits ?? []).filter((a) => ids.has(a.computerId)).slice(-40),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaign agents");
    } finally {
      setLoading(false);
    }
  }, [campaignSeats]);

  React.useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function act(
    action: "start" | "take_control" | "release_control",
    computerId: string,
  ) {
    setBusyId(computerId);
    setError(null);
    try {
      const res = await fetch("/api/fleet/computers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, computerId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        computer?: FleetComputerRow;
      };
      if (!res.ok) {
        setError(body.error ?? res.statusText);
        return;
      }
      if (action === "take_control") setObservingId(computerId);
      if (action === "start" && body.computer) {
        setObservingId(computerId);
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const observing = computers.find((c) => c.computerId === observingId) ?? null;
  const liveUrl = observing?.viewUrl || observing?.remoteUrl || null;
  const isRemoteLive =
    Boolean(liveUrl) &&
    (liveUrl!.startsWith("http://") || liveUrl!.startsWith("https://"));

  const humanCount = computers.filter((c) => c.control === "human").length;
  const readyCount = computers.filter((c) => c.status === "ready" || c.status === "busy").length;

  return (
    <section
      className="rounded-2xl border border-line bg-surface/80"
      aria-labelledby="campaign-agents-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Campaign agents
          </p>
          <h2
            id="campaign-agents-heading"
            className="mt-0.5 flex items-center gap-2 text-base font-semibold text-ink"
          >
            <Bot className="h-4 w-4 text-electric" aria-hidden />
            VMs working this campaign
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Each LinkedIn Browser Computer seat is one Chromium VM. Start it, watch live work, or
            Take control anytime — the bot pauses until you Release.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="sm" tone="electric">
            {campaignSeats.length} agents
          </Badge>
          <Badge size="sm" tone={readyCount ? "electric" : "neutral"}>
            {readyCount} live
          </Badge>
          <Badge size="sm" tone={humanCount ? "tangerine" : "neutral"}>
            {humanCount} human control
          </Badge>
          <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {error ? <p className="px-5 pt-3 text-sm text-danger">{error}</p> : null}

      {campaignSeats.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted">
          <p>
            No Browser Computer agents are attached to this campaign yet. Attach a LinkedIn Browser
            Computer seat below (or create one in Settings → LinkedIn / Fleet).
          </p>
          {availableToAttach.length > 0 && onAssignSeat ? (
            <ul className="mt-4 space-y-2">
              {availableToAttach.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="text-sm font-medium text-ink">{s.name}</span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => onAssignSeat(s.id)}>
                    <Link2 className="mr-1.5 h-3.5 w-3.5" />
                    Attach to campaign
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <ul className="divide-y divide-line/50">
            {campaignSeats.map((seat) => {
              const computerId = seat.computerId || seat.id;
              const c =
                computers.find((row) => row.computerId === computerId) ??
                ({
                  computerId,
                  seatId: seat.id,
                  seatName: seat.name,
                  status: "stopped",
                  control: "bot" as const,
                  lastAudit: null,
                  lastError: null,
                  updatedAt: "",
                } satisfies FleetComputerRow);
              const selected = observingId === computerId;
              const busy = busyId === computerId;
              return (
                <li key={seat.id} className={cn("px-5 py-4", selected && "bg-electric/5")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Monitor className="h-4 w-4 text-electric" aria-hidden />
                        <span className="text-sm font-semibold text-ink">{seat.name}</span>
                        <Badge size="sm" tone={c.control === "human" ? "tangerine" : "electric"}>
                          {c.control === "human" ? "Human control" : "Bot"}
                        </Badge>
                        <span className="text-xs text-muted">{c.status}</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-muted">{computerId}</p>
                      {c.lastAudit ? (
                        <p className="mt-1 truncate text-xs text-muted">{c.lastAudit}</p>
                      ) : null}
                      {c.lastError ? (
                        <p className="mt-1 text-xs text-danger">{c.lastError}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(c.status === "stopped" || c.status === "error") && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void act("start", computerId)}
                        >
                          Start VM
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-pressed={selected}
                        onClick={() => setObservingId(selected ? null : computerId)}
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                        {selected ? "Hide view" : "Observe"}
                      </Button>
                      {c.control === "human" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void act("release_control", computerId)}
                        >
                          <Unlock className="mr-1.5 h-3.5 w-3.5" />
                          Release
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => void act("take_control", computerId)}
                        >
                          <Hand className="mr-1.5 h-3.5 w-3.5" />
                          Take control
                        </Button>
                      )}
                      {onUnassignSeat ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onUnassignSeat(seat.id)}
                        >
                          Detach
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-line/60 lg:border-l lg:border-t-0">
            <div className="border-b border-line/50 px-4 py-3 text-sm font-semibold text-ink">
              Live viewport
              {observing ? (
                <span className="ml-2 font-mono text-xs font-normal text-muted">
                  {observing.computerId}
                </span>
              ) : (
                <span className="ml-2 text-xs font-normal text-muted">Select Observe</span>
              )}
            </div>
            {observing && isRemoteLive ? (
              <div className="space-y-2 p-3">
                <iframe
                  title={`Live view ${observing.computerId}`}
                  src={liveUrl!}
                  className="aspect-video w-full rounded-lg border border-line bg-ink/5"
                  allow="clipboard-read; clipboard-write"
                />
                <a
                  className="inline-flex items-center gap-1 text-xs font-medium text-electric"
                  href={liveUrl!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open full sandbox
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : observing && liveUrl ? (
              <div className="space-y-2 p-4 text-sm text-muted">
                <p>
                  Operator viewport ready.{" "}
                  <a className="font-medium text-electric underline" href={liveUrl} target="_blank" rel="noreferrer">
                    Open sandbox viewport
                  </a>
                </p>
                <p className="text-xs">
                  Bind a live Chromium supervisor (`COMPUTER_SUPERVISOR_URL`) for in-panel streaming.
                </p>
              </div>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-muted">
                Start a VM and click Observe to watch this campaign&apos;s agent work — or Take
                control to intervene.
              </div>
            )}

            <div className="border-t border-line/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Recent audits
              </p>
              <ol className="mt-2 max-h-48 space-y-2 overflow-auto">
                {[...audits].reverse().slice(0, 12).map((e, i) => (
                  <li key={e.id ?? `${e.at}-${i}`} className="text-xs text-muted">
                    <span className="font-medium text-ink">{e.action}</span> · {e.detail}
                    <span className="mt-0.5 block font-mono text-[10px]">
                      {e.computerId} · {e.actor}
                    </span>
                  </li>
                ))}
                {audits.length === 0 ? (
                  <li className="text-xs text-muted">No audits yet — Start or Take control to begin.</li>
                ) : null}
              </ol>
            </div>
          </div>
        </div>
      )}

      {availableToAttach.length > 0 && campaignSeats.length > 0 && onAssignSeat ? (
        <div className="border-t border-line/60 px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Attach more agents</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {availableToAttach.map((s) => (
              <Button key={s.id} type="button" size="sm" variant="secondary" onClick={() => onAssignSeat(s.id)}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                {s.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
