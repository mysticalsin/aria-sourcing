"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Hand, Unlock, Monitor, ArrowLeft, ShieldAlert, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";
import {
  FLUID_TAKEOVER,
  fluidHotkeyAction,
  isTypingTarget,
  withFluidTakeQuery,
} from "@/lib/fluid-takeover";

type ComputerState = {
  computerId: string;
  seatId: string;
  status: string;
  control: "bot" | "human";
  remoteUrl?: string | null;
  viewUrl?: string | null;
  lastError?: string | null;
  lastAudit?: string | null;
};

/**
 * In-Aria operator viewport — AgenticSeek watch + GrokBot jump-in/out.
 * When OpenBot publishes a remote URL, we embed the live CDP stream here.
 */
export default function FleetComputerViewportPage() {
  const params = useParams<{ computerId: string }>();
  const computerId = decodeURIComponent(params.computerId ?? "");
  const [computer, setComputer] = React.useState<ComputerState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [audits, setAudits] = React.useState<
    Array<{ at: string; action: string; detail: string; actor: string }>
  >([]);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/computers", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { computers?: ComputerState[] };
      const hit = (data.computers ?? []).find((c) => c.computerId === computerId) ?? null;
      setComputer(hit);
      const auditRes = await fetch(
        `/api/fleet/computers/audits?computerId=${encodeURIComponent(computerId)}&limit=20`,
        { credentials: "same-origin" },
      );
      if (auditRes.ok) {
        const auditData = (await auditRes.json()) as {
          events?: Array<{ at: string; action: string; detail: string; actor: string }>;
        };
        setAudits(auditData.events ?? []);
      }
    } catch {
      /* ignore */
    }
  }, [computerId]);

  React.useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(t);
  }, [refresh]);

  const act = React.useCallback(
    async (action: "take_control" | "release_control" | "start") => {
      setBusy(true);
      setError(null);
      try {
        const seatId = (computer?.seatId ?? "").trim();
        if (
          (action === "start" || action === "take_control") &&
          (!seatId || seatId === "__orphan__")
        ) {
          setError("Unbound host VM — reclaim/bind a seat before Start or Take control.");
          return;
        }
        const res = await fetch("/api/fleet/computers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            computerId,
            ...(seatId ? { seatId } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          computer?: ComputerState;
        };
        if (!res.ok) {
          setError(data.error ?? res.statusText);
          return;
        }
        if (data.computer) setComputer(data.computer);
        else await refresh();
      } catch {
        setError("Computer action failed");
      } finally {
        setBusy(false);
      }
    },
    [computer?.seatId, computerId, refresh],
  );

  const human = computer?.control === "human";
  const ready = Boolean(computer && computer.status !== "stopped" && computer.status !== "error");
  const liveUrl = computer?.viewUrl || computer?.remoteUrl || null;

  React.useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const action = fluidHotkeyAction(ev.key, {
        humanControl: human === true,
        typingTarget: isTypingTarget(ev.target),
      });
      if (action === "ignore") return;
      ev.preventDefault();
      if (action === "release") void act("release_control");
      if (action === "take") void act("take_control");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [human, act]);

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#0b1220_0%,_#06080f_55%,_#05070c_100%)] text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/80">
              Aria · AgenticSeek watch · GrokBot jump-in
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Monitor className="h-6 w-6 text-cyan-300" aria-hidden />
              Live computer
            </h1>
            <p className="mt-1 font-mono text-xs text-slate-400">{computerId}</p>
          </div>
          <Link
            href="/fleet"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to Fleet
          </Link>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-300">
                Status:{" "}
                <span className="font-semibold text-white">{computer?.status ?? "loading…"}</span>
              </p>
              <p className="mt-1 text-sm text-slate-300">
                Control:{" "}
                <span className={human ? "font-semibold text-amber-300" : "font-semibold text-cyan-300"}>
                  {human ? FLUID_TAKEOVER.controllingChip : FLUID_TAKEOVER.watchingChip}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {human ? FLUID_TAKEOVER.controllingHint : FLUID_TAKEOVER.watchingHint}
              </p>
              {computer?.lastAudit ? (
                <p className="mt-1 text-xs text-slate-500">Last audit: {computer.lastAudit}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {!ready ? (
                <Button type="button" size="sm" disabled={busy} onClick={() => void act("start")}>
                  Start computer
                </Button>
              ) : null}
              {human ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void act("release_control")}
                >
                  <Unlock className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {FLUID_TAKEOVER.releaseLabel}
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={busy} onClick={() => void act("take_control")}>
                  <Hand className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {FLUID_TAKEOVER.takeLabel}
                </Button>
              )}
              {liveUrl ? (
                <a
                  href={human ? withFluidTakeQuery(liveUrl) : liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
                >
                  Pop out
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          {computer?.lastError ? (
            <p className="mt-3 text-sm text-rose-300">Error: {computer.lastError}</p>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f1a]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-slate-400">
            <span>Live stream</span>
            <span>{human ? "Interactive — bot paused · Esc to get out" : "Agent may act · T to jump in"}</span>
          </div>
          {liveUrl ? (
            <iframe
              title={`Live computer ${computerId}`}
              src={human ? withFluidTakeQuery(liveUrl) : liveUrl}
              className="h-[min(70vh,720px)] w-full bg-black"
              allow="fullscreen; clipboard-read; clipboard-write"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="relative min-h-[420px] bg-[linear-gradient(160deg,#10182a_0%,#0b1322_45%,#121a2e_100%)] p-6">
              <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-black/35 p-6 backdrop-blur">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
                  <div>
                    <h2 className="text-base font-semibold text-white">
                      {human ? "You hold the LinkedIn seat" : "Waiting for live OpenBot URL"}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">
                      {human
                        ? "Automatic sends are refused while you hold control. Complete LinkedIn login / 2FA when a real OpenBot Chromium URL is bound. Press Esc or Get out · Release when finished."
                        : "Start the computer and bind COMPUTER_SUPERVISOR_URL so this surface embeds the live CDP stream (AgenticSeek-style watch). Then Take control (T) whenever you need to jump in."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-sm font-semibold text-white">Audit trail</h2>
          <p className="mt-1 text-xs text-slate-400">
            Append-only events for this computer (export CSV from Fleet ops board).
          </p>
          <ol className="mt-3 max-h-56 space-y-2 overflow-auto">
            {audits.length === 0 ? (
              <li className="text-xs text-slate-500">No events yet.</li>
            ) : (
              [...audits].reverse().map((e, i) => (
                <li key={`${e.at}-${i}`} className="border-l border-white/10 pl-3 text-xs text-slate-300">
                  <span className="font-semibold text-slate-100">{e.action}</span>
                  <span className="ml-2 uppercase tracking-wide text-slate-500">{e.actor}</span>
                  <div className="text-slate-400">{e.detail}</div>
                  <div className="font-mono text-[10px] text-slate-500">{e.at}</div>
                </li>
              ))
            )}
          </ol>
        </section>
      </div>
    </main>
  );
}
