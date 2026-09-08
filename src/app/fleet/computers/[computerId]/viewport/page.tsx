"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Hand, Unlock, Monitor, ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";

type ComputerState = {
  computerId: string;
  seatId: string;
  status: string;
  control: "bot" | "human";
  remoteUrl?: string | null;
  lastError?: string | null;
  lastAudit?: string | null;
};

/**
 * In-Aria operator viewport for Take control when a remote OpenBot Chromium
 * URL is not yet published. Real OpenBot hosts replace this with their own
 * remote desktop URL from ensure().
 */
export default function FleetComputerViewportPage() {
  const params = useParams<{ computerId: string }>();
  const computerId = decodeURIComponent(params.computerId ?? "");
  const [computer, setComputer] = React.useState<ComputerState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/computers", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { computers?: ComputerState[] };
      const hit = (data.computers ?? []).find((c) => c.computerId === computerId) ?? null;
      setComputer(hit);
    } catch {
      /* ignore */
    }
  }, [computerId]);

  React.useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function act(action: "take_control" | "release_control" | "start") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fleet/computers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, computerId }),
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
  }

  const human = computer?.control === "human";
  const ready = computer && computer.status !== "stopped" && computer.status !== "error";

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#0b1220_0%,_#06080f_55%,_#05070c_100%)] text-slate-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/80">
              Aria operator viewport
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Monitor className="h-6 w-6 text-cyan-300" aria-hidden />
              Take control
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
                  {human ? "Human (you)" : "Bot"}
                </span>
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
                  Release to bot
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={busy} onClick={() => void act("take_control")}>
                  <Hand className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Take control
                </Button>
              )}
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          {computer?.lastError ? (
            <p className="mt-3 text-sm text-rose-300">Error: {computer.lastError}</p>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f1a]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-slate-400">
            <span>Sandbox surface</span>
            <span>{human ? "Interactive — bot paused" : "Bot may act when Automatic runs"}</span>
          </div>
          <div className="relative min-h-[420px] bg-[linear-gradient(160deg,#10182a_0%,#0b1322_45%,#121a2e_100%)] p-6">
            <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-black/35 p-6 backdrop-blur">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {human ? "You hold the LinkedIn seat" : "Waiting for Take control"}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">
                    {human
                      ? "Automatic sends are refused while you hold control. Complete LinkedIn login / 2FA here when a real OpenBot Chromium URL is bound. Click Release to bot when finished."
                      : "Click Take control to pause the bot mutex and operate this seat yourself. When COMPUTER_SUPERVISOR_URL points at OpenBot, this surface is replaced by the live Chromium remote URL."}
                  </p>
                  <ol className="mt-4 list-decimal space-y-1 pl-4 text-sm text-slate-400">
                    <li>Take control (Human control badge on Fleet).</li>
                    <li>Sign into LinkedIn in the sandbox / remote desktop.</li>
                    <li>Release so Automatic can send again.</li>
                  </ol>
                </div>
              </div>
            </div>
            {human ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-amber-400/10 to-transparent" />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
