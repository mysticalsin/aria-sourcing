"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useActions, useActiveCampaignId, useCampaigns, useHermesStateGetter, useHydrated, useSeats } from "@/lib/store";
import {
  abandonAriaLiveIfActive,
  beginAriaLiveRun,
  consumeAriaLiveRestartFlag,
  getAriaLiveSnapshot,
  subscribeAriaLive,
  type AriaLiveSnapshot,
} from "@/lib/demo/aria-live";

// The cinematic (and framer-motion with it) loads only once a run starts, so
// it stays out of the bundle every page ships.
const AriaLiveOverlay = dynamic(
  () => import("@/components/demo/aria-live-overlay").then((mod) => mod.AriaLiveOverlay),
  { ssr: false },
);

/**
 * Mounted once, globally, inside TopBar (see topbar.tsx) so it's present on
 * every route TopBar renders on. Renders nothing until a run is started from
 * either trigger (the TopBar button or the ⌘K "Play Aria Live" entry — both
 * call beginAriaLiveRun in src/lib/demo/aria-live.ts).
 *
 * Purely a subscriber to that module's tiny pub/sub — it owns no run state
 * itself, so mounting/unmounting it (e.g. crossing into /login or /careers,
 * which app-shell.tsx renders without TopBar) can never desync from the
 * choreography in flight.
 */
export function AriaLiveHost() {
  const [snapshot, setSnapshot] = React.useState<AriaLiveSnapshot>(() => getAriaLiveSnapshot());
  const actions = useActions();
  const getState = useHermesStateGetter();
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
    beginAriaLiveRun({ actions, state: getState(), campaigns, activeCampaignId, seats });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Safety net: if this host unmounts while a run is still active (the
  // only route-driven way that happens is AppShell not rendering TopBar on
  // /login or /careers — app-shell.tsx), restore rather than leave the demo
  // state mutated. No-ops when no run is active or one already restored.
  React.useEffect(() => () => abandonAriaLiveIfActive(), []);

  return snapshot.active ? <AriaLiveOverlay snapshot={snapshot} /> : null;
}
