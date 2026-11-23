"use client";

import * as React from "react";
import { supabaseEnabled } from "@/lib/supabase/config";
import { odooApi, type OdooApplicantView, type OdooConnectionView, type OdooJobLink } from "./api";

/* Shared Odoo state for the campaign bar, the candidate drawer and the intake.
   Each piece refetches on the "aria:odoo-changed" window event. */

const CHANGED = "aria:odoo-changed";

export function notifyOdooChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
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
  error: string | null;
  refresh: () => void;
}

/** The campaign's Odoo job link and the live Odoo state of its applicants. */
export function useOdooCampaign(campaignId: string, enabled: boolean): OdooCampaignState {
  const changes = useChangeCounter();
  const [tick, setTick] = React.useState(0);
  const [state, setState] = React.useState<Omit<OdooCampaignState, "refresh">>({ loading: true, link: null, applicants: [], error: null });
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    void Promise.all([
      odooApi<{ links: OdooJobLink[] }>("/links"),
      odooApi<{ applicants: OdooApplicantView[] }>(`/applicants?campaignId=${encodeURIComponent(campaignId)}`),
    ]).then(([links, applicants]) => {
      if (cancelled) return;
      setState({
        loading: false,
        link: links.ok ? (links.data.links.find((l) => l.campaignId === campaignId) ?? null) : null,
        applicants: applicants.ok ? applicants.data.applicants : [],
        error: !links.ok ? links.error : !applicants.ok ? applicants.error : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, enabled, changes, tick]);
  const refresh = React.useCallback(() => setTick((v) => v + 1), []);
  return { ...state, refresh };
}
