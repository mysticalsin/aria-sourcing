"use client";

import * as React from "react";
import Link from "next/link";
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
import { Badge, Button, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AgentSeat } from "@/lib/types";
import type { FleetComputerRow } from "@/components/fleet/fleet-computers-panel";
import { BanRiskStrip } from "@/components/campaigns/ban-risk-strip";
import { useSettings } from "@/lib/store";

type AuditEvent = {
  id?: string;
  at: string;
  computerId: string;
  action: string;
  detail: string;
  actor: string;
  correlationId?: string | null;
  jobId?: string | null;
  campaignId?: string | null;
};

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "ready":
      return "ready";
    case "busy":
      return "busy";
    case "starting":
      return "starting";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
    case "help_requested":
      return "needs help";
    default:
      return status;
  }
}

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
  const { toast } = useToast();
  const settings = useSettings();
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
    try {
      const ensureErrors: string[] = [];
      for (const seat of campaignSeats) {
        const computerId = seat.computerId || seat.id;
        const ens = await fetch("/api/fleet/computers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ensure",
            computerId,
            seatId: seat.id,
            campaignId,
          }),
        }).catch(() => null);
        if (ens && !ens.ok) {
          const body = (await ens.json().catch(() => ({}))) as { error?: string };
          const msg = body.error ?? `ensure failed (${ens.status})`;
          ensureErrors.push(msg);
          if (/max computers/i.test(msg)) {
            ensureErrors.push(
              "Chromium host is at capacity — stop idle Fleet VMs or raise OPENBOT_MAX_COMPUTERS.",
            );
          }
        }
      }
      if (ensureErrors.length) {
        setError(ensureErrors[0]);
      } else {
        setError(null);
      }

      const res = await fetch(
        `/api/fleet/computers?campaignId=${encodeURIComponent(campaignId)}`,
        { credentials: "same-origin" },
      );
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
      setComputers(
        rows.map((c) => {
          const seat = campaignSeats.find(
            (s) => s.id === c.seatId || s.computerId === c.computerId,
          );
          return seat ? { ...c, seatName: seat.name } : c;
        }),
      );

      const campaignAudits = (data.recentAudits ?? []).filter(
        (a) =>
          ids.has(a.computerId) &&
          (!a.campaignId || a.campaignId === campaignId),
      );
      // Prefer campaign-tagged audits; fall back to computer-scoped when untagged.
      const tagged = campaignAudits.filter((a) => a.campaignId === campaignId);
      setAudits((tagged.length ? tagged : campaignAudits).slice(-40));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaign agents");
    } finally {
      setLoading(false);
    }
  }, [campaignSeats, campaignId]);

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
        body: JSON.stringify({ action, computerId, campaignId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        computer?: FleetComputerRow;
      };
      if (!res.ok) {
        const msg = body.error ?? res.statusText;
        setError(msg);
        toast({ title: "Computer action failed", description: msg, variant: "error" });
        return;
      }
      if (body.computer?.status === "error") {
        const msg =
          body.computer.lastError ||
          "Computer entered error state — check Chromium supervisor capacity.";
        setError(msg);
        toast({ title: "Computer action failed", description: msg, variant: "error" });
        await refresh();
        return;
      }
      if (action === "take_control" || action === "start") {
        setObservingId(computerId);
      }
      if (action === "take_control" && typeof window !== "undefined") {
        // Prefer the dedicated full-sandbox tab for LinkedIn login (keyboard + fullscreen).
        const url =
          body.computer?.viewUrl ||
          body.computer?.remoteUrl ||
          computers.find((c) => c.computerId === computerId)?.viewUrl ||
          computers.find((c) => c.computerId === computerId)?.remoteUrl;
        if (url && /^https?:\/\//i.test(url)) {
          window.open(`${url}${url.includes("?") ? "&" : "?"}fs=1`, "_blank", "noopener,noreferrer");
        }
      }
      await refresh();
      toast({
        title:
          action === "take_control"
            ? "You have control"
            : action === "release_control"
              ? "Control released"
              : action === "start"
                ? "VM started"
                : "Computer updated",
        description:
          action === "take_control"
            ? "Fullscreen sandbox opened — click LinkedIn fields and type your login, then Release when done."
            : action === "start"
              ? "Process up — Observe to watch, or Take control to log in / verify LinkedIn."
              : action === "release_control"
                ? "Bot may act again only after a healthy session probe."
                : "Bot may act again on this seat.",
        variant: "success",
      });
    } catch {
      toast({ title: "Computer action failed", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function observe(computerId: string, selected: boolean) {
    if (selected) {
      setObservingId(null);
      return;
    }
    const row = computers.find((c) => c.computerId === computerId);
    if (!row || row.status === "stopped" || row.status === "error") {
      await act("start", computerId);
      return;
    }
    setObservingId(computerId);
  }

  function detachSeat(seat: AgentSeat, computer: FleetComputerRow) {
    if (!onUnassignSeat) return;
    const live =
      computer.control === "human" ||
      computer.status === "ready" ||
      computer.status === "busy" ||
      computer.status === "help_requested";
    if (live) {
      const ok = window.confirm(
        `${seat.name} is still ${computer.control === "human" ? "under human control" : "live"}. Detach from this campaign only? The Chromium VM stays running on Fleet.`,
      );
      if (!ok) return;
    }
    onUnassignSeat(seat.id);
  }

  const observing = computers.find((c) => c.computerId === observingId) ?? null;
  const liveUrl = observing?.viewUrl || observing?.remoteUrl || null;
  const isRemoteLive =
    Boolean(liveUrl) &&
    (liveUrl!.startsWith("http://") || liveUrl!.startsWith("https://"));

  const humanCount = computers.filter((c) => c.control === "human").length;
  const healthyCount = computers.filter((c) => c.sessionHealthy === true).length;
  const unverifiedCount = computers.filter(
    (c) => (c.status === "ready" || c.status === "busy") && c.sessionHealthy !== true,
  ).length;

  return (
    <div className="space-y-4">
    <BanRiskStrip seats={campaignSeats} audits={audits} fleet={settings.fleet} />
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
            Agents on this campaign
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            LinkedIn AriaBot Browser Computer seats attached here — one Chromium VM each. Observe starts the
            VM if needed; Take control pauses the bot until you Release.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="sm" tone="electric">
            {campaignSeats.length} attached
          </Badge>
          <Badge size="sm" tone={healthyCount ? "success" : "neutral"}>
            {healthyCount} session healthy
          </Badge>
          {unverifiedCount > 0 ? (
            <Badge size="sm" tone="warning">
              {unverifiedCount} unverified
            </Badge>
          ) : null}
          <Badge size="sm" tone={humanCount ? "tangerine" : "neutral"}>
            {humanCount} human control
          </Badge>
          <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
            Refresh
          </Button>
          <Link
            href="/fleet"
            className="inline-flex h-9 items-center rounded-full bg-ink px-3.5 text-sm font-semibold text-paper hover:bg-ink/90"
          >
            Allocate on Fleet
          </Link>
        </div>
      </div>

      {error ? <p className="px-5 pt-3 text-sm text-danger">{error}</p> : null}

      {campaignSeats.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted">
          <p>
            No Browser Computer agents are attached to this campaign yet. Attach a LinkedIn Browser
            Computer seat below, or open{" "}
            <Link href="/fleet" className="font-medium text-electric underline-offset-2 hover:underline">
              Fleet
            </Link>{" "}
            to deploy/boot VMs (host cap applies).
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
                  sessionHealthy: null,
                  lastAudit: null,
                  lastError: null,
                  updatedAt: "",
                } satisfies FleetComputerRow);
              const selected = observingId === computerId;
              const busy = busyId === computerId;
              const needsHelp = c.status === "help_requested";
              const sessionTone =
                c.sessionHealthy === true
                  ? "success"
                  : c.sessionHealthy === false || needsHelp || c.status === "error"
                    ? "danger"
                    : c.status === "ready" || c.status === "busy"
                      ? "warning"
                      : "neutral";
              const sessionLabel =
                c.sessionHealthy === true
                  ? "Session healthy"
                  : c.sessionHealthy === false
                    ? "Session unhealthy"
                    : c.status === "ready" || c.status === "busy"
                      ? "Session unverified"
                      : null;
              return (
                <li
                  key={seat.id}
                  className={cn(
                    "px-5 py-4",
                    selected && "bg-electric/5",
                    needsHelp && "bg-tangerine/5",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Monitor className="h-4 w-4 text-electric" aria-hidden />
                        <span className="text-sm font-semibold text-ink">{seat.name}</span>
                        <Badge size="sm" tone={c.control === "human" ? "tangerine" : "electric"}>
                          {c.control === "human" ? "Human control" : "Bot"}
                        </Badge>
                        <Badge
                          size="sm"
                          tone={
                            needsHelp || c.status === "error"
                              ? "tangerine"
                              : c.sessionHealthy === true
                                ? "success"
                                : c.status === "ready" || c.status === "busy"
                                  ? "warning"
                                  : "neutral"
                          }
                        >
                          {statusLabel(c.status)}
                        </Badge>
                        {sessionLabel ? (
                          <Badge size="sm" tone={sessionTone}>
                            {sessionLabel}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-muted">{computerId}</p>
                      {c.lastAudit ? (
                        <p className="mt-1 truncate text-xs text-muted">{c.lastAudit}</p>
                      ) : null}
                      {c.lastError ? (
                        <p className="mt-1 text-xs text-danger">{c.lastError}</p>
                      ) : null}
                      {needsHelp ? (
                        <p className="mt-1 text-xs font-medium text-tangerine">
                          Needs operator help — Take control to finish LinkedIn login / 2FA.
                        </p>
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
                        disabled={busy}
                        onClick={() => void observe(computerId, selected)}
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
                          onClick={() => detachSeat(seat, c)}
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
              <div
                className={cn(
                  "space-y-2 p-3",
                  observing.control === "human" &&
                    "fixed inset-0 z-50 flex flex-col bg-ink p-0 sm:p-0",
                )}
              >
                {observing.control === "human" ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0c1424] px-3 py-2 text-xs text-paper">
                    <p>
                      <span className="font-medium text-tangerine">You have control — bot paused. </span>
                      Click and type in the sandbox to finish LinkedIn login / 2FA, then Release.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <a
                        className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 font-medium text-electric"
                        href={`${liveUrl!}${liveUrl!.includes("?") ? "&" : "?"}fs=1`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open full sandbox
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busyId === observing.computerId}
                        onClick={() => void act("release_control", observing.computerId)}
                      >
                        <Unlock className="mr-1.5 h-3.5 w-3.5" />
                        Release
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Observe mode — Take control for fullscreen interactive login.
                  </p>
                )}
                <iframe
                  title={`Live view ${observing.computerId}`}
                  src={
                    observing.control === "human"
                      ? `${liveUrl!}${liveUrl!.includes("?") ? "&" : "?"}fs=1`
                      : liveUrl!
                  }
                  className={cn(
                    "w-full rounded-lg border border-line bg-ink/5",
                    observing.control === "human"
                      ? "min-h-0 flex-1 rounded-none border-0"
                      : "aspect-video",
                  )}
                  allow="clipboard-read; clipboard-write; fullscreen"
                  allowFullScreen
                />
                {observing.control !== "human" ? (
                  <a
                    className="inline-flex items-center gap-1 text-xs font-medium text-electric"
                    href={`${liveUrl!}${liveUrl!.includes("?") ? "&" : "?"}fs=1`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open full sandbox
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            ) : observing && liveUrl ? (
              <div className="space-y-2 p-4 text-sm text-muted">
                {observing.control === "human" ? (
                  <p className="rounded-lg border border-tangerine/40 bg-tangerine/10 px-3 py-2 text-xs text-ink">
                    <span className="font-medium text-tangerine">You have control — bot paused. </span>
                    Open the sandbox to finish LinkedIn login / 2FA, then Release.
                  </p>
                ) : null}
                <p>
                  Operator viewport ready.{" "}
                  <a className="font-medium text-electric underline" href={liveUrl} target="_blank" rel="noreferrer">
                    Open sandbox viewport
                  </a>
                </p>
              </div>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-muted">
                Click Observe to start (if needed) and watch this campaign&apos;s agent — or Take
                control to intervene.
              </div>
            )}

            <div className="border-t border-line/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Recent audits
              </p>
              <ol className="mt-2 max-h-48 space-y-2 overflow-auto">
                {[...audits].reverse().slice(0, 12).map((e, i) => {
                  const hot =
                    e.action === "takeover" ||
                    e.action === "help_requested" ||
                    e.action.includes("failed");
                  return (
                    <li
                      key={e.id ?? `${e.at}-${i}`}
                      className={cn("text-xs text-muted", hot && "text-ink")}
                    >
                      <span className="font-medium text-ink">{e.action}</span> · {e.detail}
                      <span className="mt-0.5 block font-mono text-[10px]">
                        {relativeTime(e.at)} · {e.computerId} · {e.actor}
                        {e.correlationId ? ` · ${e.correlationId}` : ""}
                        {e.jobId ? ` · job ${e.jobId}` : ""}
                      </span>
                    </li>
                  );
                })}
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
    </div>
  );
}
