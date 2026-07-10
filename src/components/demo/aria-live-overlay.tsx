"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, RotateCcw, Sparkles, SkipForward, X, XCircle } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useCountUp } from "@/components/reveal/use-count-up";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { useActiveCampaignId, useCampaigns, useHermes, useHydrated, useSeats } from "@/lib/store";
import {
  ARIA_LIVE_CHAPTERS,
  beginAriaLiveRun,
  consumeAriaLiveRestartFlag,
  dismissAriaLive,
  getAriaLiveSnapshot,
  restartAriaLive,
  skipAriaLive,
  subscribeAriaLive,
  abandonAriaLiveIfActive,
  type AriaLiveSnapshot,
} from "@/lib/demo/aria-live";

const CHAPTER_LABELS: Record<string, string> = {
  sourcing: "Source",
  drafting: "Draft",
  approving: "Approve",
  replying: "Reply",
  booking: "Book",
  reporting: "Report",
  done: "Done",
};

/**
 * The Aria Live (Demo Director) letterbox — mounted once, globally, inside
 * TopBar (see topbar.tsx) so it's present on every route TopBar renders on
 * and renders nothing until a run is actually started from either trigger
 * (the TopBar button or the ⌘K "Play Aria Live" entry — both call
 * beginAriaLiveRun in src/lib/demo/aria-live.ts).
 *
 * Purely a subscriber to that module's tiny pub/sub — it owns no run state
 * itself, so mounting/unmounting it (e.g. crossing into /login or /careers,
 * which app-shell.tsx renders without TopBar) can never desync from the
 * choreography in flight.
 */
export function AriaLiveOverlay() {
  const [snapshot, setSnapshot] = React.useState<AriaLiveSnapshot>(() => getAriaLiveSnapshot());
  const reducedMotion = usePrefersReducedMotion();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const closeBtnRef = React.useRef<HTMLButtonElement>(null);

  const { state, actions } = useHermes();
  const hydrated = useHydrated();
  const campaigns = useCampaigns();
  const activeCampaignId = useActiveCampaignId();
  const seats = useSeats();

  React.useEffect(() => subscribeAriaLive(setSnapshot), []);

  // Restart = restore-then-reload (see restartAriaLive) followed by an
  // automatic relaunch the moment the fresh mount is hydrated again — so
  // "Restart" reads as an instant replay rather than "now go click Play
  // again yourself". consumeAriaLiveRestartFlag() is one-shot: it only ever
  // fires once per Restart click.
  React.useEffect(() => {
    if (!hydrated) return;
    if (!consumeAriaLiveRestartFlag()) return;
    beginAriaLiveRun({ actions, state, campaigns, activeCampaignId, seats });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Safety net: if this overlay unmounts while a run is still active (the
  // only route-driven way that happens is AppShell not rendering TopBar on
  // /login or /careers — app-shell.tsx), restore rather than leave the demo
  // state mutated. No-ops when no run is active or one already restored.
  React.useEffect(() => () => abandonAriaLiveIfActive(), []);

  React.useEffect(() => {
    if (snapshot.finished) closeBtnRef.current?.focus();
  }, [snapshot.finished]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!snapshot.active || !dialog) return;
    if (!dialog.open) dialog.showModal();
    lockBodyScroll();
    dialog.querySelector<HTMLElement>("button")?.focus();
    return () => {
      if (dialog.open) dialog.close();
      unlockBodyScroll();
    };
  }, [snapshot.active]);

  if (!snapshot.active) return null;

  const chapterLabel = CHAPTER_LABELS[snapshot.chapter] ?? snapshot.chapter;
  const barTransition = reducedMotion ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <dialog
      ref={dialogRef}
      className="aria-live-overlay m-0 h-screen max-h-none w-screen max-w-none border-0 bg-transparent p-0"
      aria-label="Aria Live cinematic"
      onCancel={(event) => {
        event.preventDefault();
        if (snapshot.finished) dismissAriaLive();
        else skipAriaLive();
      }}
    >
      {/* Top letterbox bar */}
      <motion.div
        initial={reducedMotion ? false : { height: 0 }}
        animate={{ height: "13vh" }}
        transition={barTransition}
        className="relative flex shrink-0 items-start justify-between overflow-hidden bg-ink px-5 py-4"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-electric" aria-hidden />
          <span className="text-sm font-bold tracking-wide text-paper">Aria Live</span>
          <Badge tone="electric" size="sm">
            {chapterLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {!snapshot.finished && (
            <Button variant="ghost" size="sm" className="text-paper hover:bg-paper/10" onClick={() => skipAriaLive()}>
              <SkipForward className="h-4 w-4" /> Skip
            </Button>
          )}
          <Button
            ref={snapshot.finished ? undefined : closeBtnRef}
            variant="ghost"
            size="icon"
            className="text-paper hover:bg-paper/10"
            aria-label="Close Aria Live"
            onClick={() => dismissAriaLive()}
            leftIcon={<X className="h-4 w-4" />}
          />
        </div>
      </motion.div>

      {/* The stage stays transparent so the director remains visible, but it
          catches pointer input while the native dialog keeps the page inert. */}
      <div className="aria-live-stage flex-1 pointer-events-auto bg-transparent" />

      {/* Bottom letterbox bar — captions + chapter progress */}
      <motion.div
        initial={reducedMotion ? false : { height: 0 }}
        animate={{ height: "13vh" }}
        transition={barTransition}
        className="relative flex shrink-0 flex-col justify-center gap-2 overflow-hidden bg-ink px-5 py-4"
      >
        <div className="flex items-center gap-1.5" aria-hidden>
          {ARIA_LIVE_CHAPTERS.map((c, i) => (
            <span
              key={c}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= snapshot.chapterIndex ? "bg-electric" : "bg-paper/15"
              }`}
            />
          ))}
        </div>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-paper/50">
          Step {snapshot.chapterIndex + 1} of {snapshot.chapterCount}
        </p>
        <AnimatePresence mode="wait">
          <motion.p
            key={snapshot.caption}
            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? {} : { opacity: 0, y: -6 }}
            transition={{ duration: reducedMotion ? 0 : 0.25 }}
            className="truncate text-base font-semibold text-paper"
            aria-live="polite"
          >
            {snapshot.caption}
          </motion.p>
        </AnimatePresence>
      </motion.div>

      {/* Final result card */}
      {snapshot.finished && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
          <motion.div
            aria-label={snapshot.error ? "Aria Live stopped early" : "Hire funnel complete"}
            initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.3 }}
            className="w-full max-w-md rounded-3xl bg-paper p-6 shadow-lift"
          >
            <div className="mb-3 flex items-center gap-2">
              {snapshot.error ? (
                <XCircle className="h-5 w-5 text-danger" aria-hidden />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
              )}
              <h2 className="text-lg font-bold text-ink">
                {snapshot.error ? "Aria Live stopped early" : "Hire funnel complete"}
              </h2>
            </div>
            <p className="mb-5 text-sm text-ink-soft">{snapshot.error ?? snapshot.caption}</p>
            <div className="mb-6 grid grid-cols-3 gap-3">
              <KpiTile label="Sourced" value={snapshot.kpis.sourced} />
              <KpiTile label="Drafted" value={snapshot.kpis.drafted} />
              <KpiTile label="Approved" value={snapshot.kpis.approved} />
              <KpiTile label="Replied" value={snapshot.kpis.replies} />
              <KpiTile label="Booked" value={snapshot.kpis.booked} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => restartAriaLive()}>
                <RotateCcw className="h-4 w-4" /> Restart
              </Button>
              <Button ref={closeBtnRef} variant="primary" className="flex-1" onClick={() => dismissAriaLive()}>
                Close
              </Button>
            </div>
            <p className="mt-4 text-center text-xs text-muted">
              Synthetic demo run, fully reverted on close. Nothing was sent.
            </p>
          </motion.div>
        </div>
      )}
    </dialog>
  );
}

function KpiTile({ label, value }: { label: string; value: number }) {
  const displayed = useCountUp(value, { durationMs: 600 });
  return (
    <div className="rounded-2xl bg-ink/5 px-3 py-3 text-center">
      <p className="text-2xl font-black tabular-nums text-ink">{Math.round(displayed)}</p>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
