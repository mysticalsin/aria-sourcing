"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Badge, Button, Card, CardContent, Eyebrow, Input, Field, useToast } from "@/components/ui";
import { useActions, useRole, useSeats } from "@/lib/store";
import { can } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
import { isLinkedInSeatProvider } from "@/lib/linkedin-connections";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, CheckCircle2, Linkedin, ShieldCheck, Unplug, Wand2 } from "lucide-react";
import { LINKEDIN_EVENT_TYPES, type LinkedInEventType } from "@/lib/linkedin-events";

type ProviderReadiness = {
  assistedManual: boolean;
  vendorApiConfigured: boolean;
  inboundWebhookSecret: boolean;
};

type SeatRow = {
  id: string;
  name: string;
  provider: string;
  status: string;
  mode: string;
  operatorEmail?: string;
  connectedAccount?: string | null;
  adapterConfigured?: boolean;
  inboundRoute?: { routeKey: string; operatorLabel: string; active: boolean } | null;
};

export function LinkedInConnectionsPanel() {
  const actions = useActions();
  const role = useRole();
  const localSeats = useSeats();
  const { toast } = useToast();
  const isAdmin = can(role, "manage_fleet");
  const [loading, setLoading] = React.useState(true);
  const [connecting, setConnecting] = React.useState(false);
  const [testingSeat, setTestingSeat] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState("");
  const [providers, setProviders] = React.useState<ProviderReadiness | null>(null);
  const [seats, setSeats] = React.useState<SeatRow[]>([]);
  const [simProfile, setSimProfile] = React.useState("https://www.linkedin.com/in/example-candidate");
  const [simBody, setSimBody] = React.useState("Thanks — I'm interested. When can we talk?");
  const [simType, setSimType] = React.useState<LinkedInEventType>("reply");
  const [simulating, setSimulating] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/linkedin/connections", { method: "GET", credentials: "include" });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        demo?: boolean;
        detail?: string;
        error?: string;
        providers?: ProviderReadiness;
        seats?: SeatRow[];
      } | null;
      if (json?.providers) setProviders(json.providers);

      const localLinkedIn = localSeats
        .filter((s) => isLinkedInSeatProvider(s.provider))
        .map((s) => ({
          id: s.id,
          name: s.name,
          provider: s.provider,
          status: s.status,
          mode: s.mode,
          connectedAccount: s.connectedAccount,
          operatorEmail: s.operatorEmail,
        }));

      // Demo (no Supabase): prefer client seats — API returns seats:[] and must not wipe UI.
      if (json?.demo || !supabaseEnabled) {
        setSeats(localLinkedIn);
      } else if (Array.isArray(json?.seats)) {
        setSeats(json.seats);
      }

      if (json?.error && !json.ok) {
        toast({ title: "LinkedIn status", description: json.error, variant: "error" });
      }
    } catch {
      toast({ title: "LinkedIn status failed", description: "Network error.", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [localSeats, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function connectAssisted() {
    if (!supabaseEnabled) {
      setConnecting(true);
      try {
        // Demo: create local seat via store (durable route_key needs Supabase).
        const seat = await actions.addSeat({
          name: "My LinkedIn (assisted)",
          operatorEmail: label.includes("@") ? label : "operator@demo.local",
          provider: "LinkedIn Assisted Manual",
        });
        if (!seat) {
          toast({
            title: "Connect failed",
            description: "Could not create a local LinkedIn seat.",
            variant: "error",
          });
          return;
        }
        actions.updateSeat(seat.id, { connectedAccount: label.trim() || "Operator LinkedIn" });
        const live = await actions.toggleSeatLive(seat.id);
        if (!live.ok) {
          toast({ title: "Seat created", description: live.reason, variant: "warning" });
        } else {
          toast({
            title: "LinkedIn assisted-manual ready",
            description: "Draft → copy into LinkedIn → Confirm send in Aria.",
            variant: "success",
          });
        }
        // Refresh from local store without waiting on a wipe-prone API list.
        setSeats((prev) => {
          const row = {
            id: seat.id,
            name: seat.name,
            provider: seat.provider,
            status: seat.status,
            mode: "live" as const,
            connectedAccount: label.trim() || "Operator LinkedIn",
            operatorEmail: seat.operatorEmail,
          };
          if (prev.some((s) => s.id === seat.id)) {
            return prev.map((s) => (s.id === seat.id ? { ...s, ...row } : s));
          }
          return [...prev, row];
        });
      } catch (err) {
        toast({
          title: "Connect failed",
          description: err instanceof Error ? err.message : "Unexpected error.",
          variant: "error",
        });
      } finally {
        setConnecting(false);
      }
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch("/api/linkedin/connections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ensure_connect",
          provider: "LinkedIn Assisted Manual",
          operatorLabel: label.trim() || undefined,
          goLive: true,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        status?: string;
        routeKey?: string;
      } | null;
      if (json?.status === "dry-run") {
        toast({ title: "Public demo only", description: json.detail, variant: "info" });
        return;
      }
      if (!json?.ok) {
        toast({ title: "Connect failed", description: json?.error ?? `HTTP ${res.status}`, variant: "error" });
        return;
      }
      toast({
        title: "LinkedIn connected",
        description: json.detail ?? "Assisted-manual seat is live.",
        variant: "success",
      });
      await load();
    } catch {
      toast({ title: "Connect failed", description: "Network error.", variant: "error" });
    } finally {
      setConnecting(false);
    }
  }

  async function simulateEvent(seatId?: string) {
    setSimulating(true);
    try {
      const res = await fetch("/api/linkedin/simulate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: simType,
          profileUrl: simProfile,
          body: simType === "reply" ? simBody : "",
          seatId: seatId || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        status?: string;
        detail?: string;
        error?: string;
        classifyQueued?: boolean;
        duplicate?: boolean;
        eventType?: string;
      } | null;
      if (json?.status === "dry-run") {
        toast({ title: "Public demo only", description: json.detail, variant: "info" });
        return;
      }
      if (!json?.ok) {
        toast({ title: "Simulate failed", description: json?.error ?? `HTTP ${res.status}`, variant: "error" });
        return;
      }
      toast({
        title: `Simulated ${json.eventType ?? simType}`,
        description: json.duplicate
          ? "Duplicate event (idempotent)."
          : json.classifyQueued
            ? "Reply recorded — classify queued."
            : "Event recorded.",
        variant: "success",
      });
    } catch {
      toast({ title: "Simulate failed", description: "Network error.", variant: "error" });
    } finally {
      setSimulating(false);
    }
  }

  async function testSeat(seatId: string) {
    setTestingSeat(seatId);
    try {
      const res = await fetch("/api/linkedin/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatId }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;
      toast({
        title: json?.ok ? "LinkedIn validated" : "LinkedIn needs attention",
        description: json?.message ?? json?.error ?? `HTTP ${res.status}`,
        variant: json?.ok ? "success" : "error",
      });
      await load();
    } catch {
      toast({ title: "Validate failed", description: "Network error.", variant: "error" });
    } finally {
      setTestingSeat(null);
    }
  }

  return (
    <Card className="overflow-hidden border-sky-500/20 bg-gradient-to-br from-surface via-surface to-sky-500/[0.06]">
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Eyebrow>Messaging</Eyebrow>
            <p className="mt-1 text-sm font-semibold text-ink">Connect LinkedIn (safe)</p>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              Aria never logs into LinkedIn or stores your password. You connect an{" "}
              <strong className="font-semibold text-ink">assisted-manual</strong> seat: Aria drafts,
              you paste/send in LinkedIn, then confirm here. Vendor API is optional when contracted.
            </p>
          </div>
          <Badge tone={seats.some((s) => s.mode === "live") ? "success" : "neutral"} size="sm" dot>
            {seats.some((s) => s.mode === "live") ? "Ready" : "Not connected"}
          </Badge>
        </div>

        {providers && (
          <div className="flex flex-wrap gap-2">
            <Badge tone="success" size="sm" dot>
              Assisted-manual
            </Badge>
            <Badge tone={providers.vendorApiConfigured ? "success" : "warning"} size="sm" dot>
              Vendor API {providers.vendorApiConfigured ? "configured" : "dark"}
            </Badge>
            <Badge tone={providers.inboundWebhookSecret ? "success" : "warning"} size="sm" dot>
              Inbound webhook secret
            </Badge>
          </div>
        )}

        {isAdmin && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Operator label" htmlFor="li-operator-label" hint="Your name or LinkedIn handle — not a password.">
              <Input
                id="li-operator-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Alex Recruiter"
              />
            </Field>
            <Button
              size="sm"
              leftIcon={<Linkedin className="h-4 w-4" />}
              loading={connecting}
              onClick={() => void connectAssisted()}
            >
              Connect my LinkedIn
            </Button>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-muted">Loading LinkedIn seats…</p>
        ) : seats.length === 0 ? (
          <p className="text-xs text-muted">No LinkedIn seat yet. Connect above to enable messaging.</p>
        ) : (
          <ul className="space-y-3">
            {seats.map((s, i) => {
              const ready = s.mode === "live" && s.status === "active";
              return (
                <motion.li
                  key={s.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={cn(
                    "rounded-2xl border border-line bg-surface/90 p-4",
                    ready ? "border-success/20" : "border-warning/25",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {ready ? (
                          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                        )}
                        <span className="truncate text-sm font-semibold text-ink">{s.name}</span>
                        <Badge tone="neutral" size="sm">
                          {s.provider}
                        </Badge>
                        <Badge tone={s.mode === "live" ? "tangerine" : "aqua"} size="sm">
                          {s.mode}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {s.connectedAccount || s.operatorEmail || "No operator label"}
                        {s.inboundRoute?.active ? " · inbound route OK" : " · inbound route missing"}
                        {s.adapterConfigured === false ? " · adapter not configured" : ""}
                      </p>
                      {s.inboundRoute?.routeKey && (
                        <p className="mt-1 truncate font-mono text-[10px] text-muted" title={s.inboundRoute.routeKey}>
                          route_key: {s.inboundRoute.routeKey.slice(0, 12)}…
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="subtle"
                        leftIcon={<Activity className="h-3.5 w-3.5" />}
                        loading={testingSeat === s.id}
                        onClick={() => void testSeat(s.id)}
                      >
                        Validate
                      </Button>
                      {isAdmin && s.mode === "live" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={<Unplug className="h-3.5 w-3.5" />}
                          onClick={() => void actions.toggleSeatLive(s.id).then(() => load())}
                        >
                          Pause
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}

        <ol className="space-y-1.5 text-xs text-muted">
          <li>1. Connect → live assisted-manual seat</li>
          <li>2. Source candidates → draft LinkedIn outreach → approve</li>
          <li>3. Copy → open LinkedIn → paste/send → Confirm in Aria</li>
          <li>4. Candidate answers → vendor webhook (or Simulate below) → classify</li>
        </ol>

        {isAdmin && (
          <div className="space-y-3 rounded-2xl border border-dashed border-sky-500/30 bg-sky-500/[0.04] p-4">
            <p className="text-xs font-semibold text-ink">Simulate HeyReach event (admin)</p>
            <p className="text-[11px] text-muted">
              Proves reply webhook → classify without a vendor. Does not call linkedin.com.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Event type" htmlFor="li-sim-type">
                <select
                  id="li-sim-type"
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                  value={simType}
                  onChange={(e) => setSimType(e.target.value as LinkedInEventType)}
                >
                  {LINKEDIN_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Profile URL" htmlFor="li-sim-profile">
                <Input
                  id="li-sim-profile"
                  value={simProfile}
                  onChange={(e) => setSimProfile(e.target.value)}
                  placeholder="https://www.linkedin.com/in/…"
                />
              </Field>
            </div>
            {simType === "reply" && (
              <Field label="Reply body" htmlFor="li-sim-body">
                <Input
                  id="li-sim-body"
                  value={simBody}
                  onChange={(e) => setSimBody(e.target.value)}
                />
              </Field>
            )}
            <Button
              size="sm"
              variant="subtle"
              leftIcon={<Wand2 className="h-3.5 w-3.5" />}
              loading={simulating}
              onClick={() => void simulateEvent(seats[0]?.id)}
            >
              Simulate event
            </Button>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-xs text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Policy: no scrape, no session bots, no password storage. See{" "}
          <code className="rounded bg-ink/[0.06] px-1 font-mono">docs/LINKEDIN_HEYREACH_PARITY.md</code>.
        </p>
      </CardContent>
    </Card>
  );
}
