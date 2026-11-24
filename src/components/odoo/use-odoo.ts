"use client";

import * as React from "react";
import { WORKSPACE_PULL_EVENT } from "@/lib/store";
import { supabaseEnabled } from "@/lib/supabase/config";
import { jsonBody, odooApi, type OdooApplicantView, type OdooConnectionView, type OdooJobLink, type OdooStageChange } from "./api";

/* Shared Odoo state for the campaign bar, the candidate drawer and the intake.
   Each piece refetches on the "aria:odoo-changed" window event. */

const CHANGED = "aria:odoo-changed";

export function notifyOdooChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/** Ask the store for the server's newer workspace now (the server applied
 *  Odoo's changes, or wrote a hand-off note). */
export function pullWorkspace(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKSPACE_PULL_EVENT));
}

function useChangeCounter(): number {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setN((v) => v + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);
  return n;
}

let connectionCache: { at: number; value: Promise<boolean> } | null = null;

/** True once Odoo is known to be connected for this workspace (cached 60 s). */
export function useOdooConnected(): boolean {
  const changes = useChangeCounter();
  const [connected, setConnected] = React.useState(false);
  React.useEffect(() => {
    if (!supabaseEnabled) return;
    let cancelled = false;
    if (!connectionCache || Date.now() - connectionCache.at > 60_000 || changes > 0) {
      connectionCache = {
        at: Date.now(),
        value: odooApi<{ connection: OdooConnectionView }>("/config").then((res) => res.ok && res.data.connection.configured),
      };
    }
    void connectionCache.value.then((value) => {
      if (!cancelled) setConnected(value);
    });
    return () => {
      cancelled = true;
    };
  }, [changes]);
  return connected;
}

export interface OdooCampaignState {
  loading: boolean;
  link: OdooJobLink | null;
  applicants: OdooApplicantView[];
  /** Candidates the last sync moved in ARIA (server side). */
  changes: OdooStageChange[];
  error: string | null;
  refresh: () => void;
}

/**
 * The campaign's Odoo job link and the Odoo state of its applicants. With
 * `apply` (the user may source), the server applies Odoo's stages to the
 * workspace (POST /sync, same path as the Odoo webhook); otherwise it is a
 * read. Either way the store then pulls the server's newer version.
 */
export function useOdooCampaign(campaignId: string, enabled: boolean, apply = false): OdooCampaignState {
  const changes = useChangeCounter();
  const [tick, setTick] = React.useState(0);
  const [state, setState] = React.useState<Omit<OdooCampaignState, "refresh">>({ loading: true, link: null, applicants: [], changes: [], error: null });
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    void Promise.all([
      odooApi<{ links: OdooJobLink[] }>("/links"),
      apply
        ? odooApi<{ applicants: OdooApplicantView[]; changes: OdooStageChange[] }>("/sync", jsonBody("POST", { campaignId }))
        : odooApi<{ applicants: OdooApplicantView[] }>(`/applicants?campaignId=${encodeURIComponent(campaignId)}`),
    ]).then(([links, applicants]) => {
      if (cancelled) return;
      setState({
        loading: false,
        link: links.ok ? (links.data.links.find((l) => l.campaignId === campaignId) ?? null) : null,
        applicants: applicants.ok ? applicants.data.applicants : [],
        changes: applicants.ok ? ((applicants.data as { changes?: OdooStageChange[] }).changes ?? []) : [],
        error: !links.ok ? links.error : !applicants.ok ? applicants.error : null,
      });
      if (applicants.ok && applicants.data.applicants.length > 0) pullWorkspace();
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, enabled, apply, changes, tick]);
  const refresh = React.useCallback(() => setTick((v) => v + 1), []);
  return { ...state, refresh };
}
