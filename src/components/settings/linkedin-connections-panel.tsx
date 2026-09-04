"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Badge, Button, Input, Field, useToast } from "@/components/ui";
import { useActions, useRole, useSeats } from "@/lib/store";
import { can } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
import { isLinkedInSeatProvider } from "@/lib/linkedin-connections";
import {
  ConnectedIdentityBanner,
  ConnectionListItem,
  ConnectionStep,
  SystemReadiness,
  type ReadinessItem,
  type StepState,
} from "@/components/settings/integration-connection-primitives";
import {
  Activity,
  Linkedin,
  Unplug,
  Wand2,
} from "lucide-react";
import { LINKEDIN_EVENT_TYPES, type LinkedInEventType } from "@/lib/linkedin-events";
import {
  appendLinkedInDemoEvent,
  type LinkedInDemoChannelEvent,
} from "@/lib/linkedin-demo-events-store";

type ProviderReadiness = {
  oauthConfigured: boolean;
  encryptionReady: boolean;
  assistedManual: boolean;
  vendorApiConfigured: boolean;
  browserComputerConfigured: boolean;
  inboundWebhookSecret: boolean;
};

type OAuthProfile = {
  displayName: string;
  email: string | null;
  pictureUrl: string | null;
  connectedAt: string;
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
  oauthConnected?: boolean;
  oauthProfile?: OAuthProfile | null;
  inboundRoute?: { routeKey: string; operatorLabel: string; active: boolean } | null;
};

type LinkedInConnectionsValue = ReturnType<typeof useLinkedInConnectionsState>;

const LinkedInConnectionsContext = React.createContext<LinkedInConnectionsValue | null>(null);

export function LinkedInConnectionsProvider({ children }: { children: React.ReactNode }) {
  const value = useLinkedInConnectionsState();
  return (
    <LinkedInConnectionsContext.Provider value={value}>{children}</LinkedInConnectionsContext.Provider>
  );
}

export function useLinkedInConnections(): LinkedInConnectionsValue {
  const ctx = React.useContext(LinkedInConnectionsContext);
  if (ctx) return ctx;
  return useLinkedInConnectionsState();
}

function useLinkedInConnectionsState() {
  const actions = useActions();
  const role = useRole();
  const localSeats = useSeats();
  const { toast } = useToast();
  const isAdmin = can(role, "manage_fleet");
  const [loading, setLoading] = React.useState(true);
  const [connectingOAuth, setConnectingOAuth] = React.useState(false);
  const [connectingAssisted, setConnectingAssisted] = React.useState(false);
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

  async function connectWithLinkedInOAuth() {
    if (!supabaseEnabled) {
      toast({
        title: "Live mode required",
        description: "Configure Supabase, then Sign in with LinkedIn here.",
        variant: "error",
      });
      return;
    }
    setConnectingOAuth(true);
    try {
      const res = await fetch("/api/linkedin/connections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure_oauth", goLive: true }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        status?: string;
        authorizeUrl?: string;
      } | null;
      if (json?.status === "dry-run") {
        toast({ title: "Public demo only", description: json.detail, variant: "info" });
        return;
      }
      if (!json?.ok || !json.authorizeUrl) {
        toast({
          title: "LinkedIn Sign In unavailable",
          description: json?.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }
      window.location.href = json.authorizeUrl;
    } catch {
      toast({ title: "Connect failed", description: "Network error.", variant: "error" });
      setConnectingOAuth(false);
    }
  }

  async function connectAssisted() {
    if (!supabaseEnabled) {
      setConnectingAssisted(true);
      try {
        const seat = await actions.addSeat({
          name: "My LinkedIn (assisted)",
          operatorEmail: label.includes("@") ? label : "operator@demo.local",
          provider: "LinkedIn Assisted Manual",
        });
        if (!seat) {
          toast({ title: "Connect failed", description: "Could not create a local LinkedIn seat.", variant: "error" });
          return;
        }
        actions.updateSeat(seat.id, { connectedAccount: label.trim() || "Operator LinkedIn" });
        const live = await actions.toggleSeatLive(seat.id);
        toast({
          title: live.ok ? "Assisted-manual seat ready" : "Seat created",
          description: live.ok
            ? "Draft → copy into LinkedIn → Confirm send in Aria. (Demo has no durable OAuth.)"
            : live.reason,
          variant: live.ok ? "success" : "warning",
        });
        await load();
      } finally {
        setConnectingAssisted(false);
      }
      return;
    }
    setConnectingAssisted(true);
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
      } | null;
      if (json?.status === "dry-run") {
        toast({ title: "Public demo only", description: json.detail, variant: "info" });
        return;
      }
      if (!json?.ok) {
        toast({ title: "Connect failed", description: json?.error ?? `HTTP ${res.status}`, variant: "error" });
        return;
      }
      toast({ title: "Assisted-manual seat ready", description: json.detail, variant: "success" });
      await load();
    } catch {
      toast({ title: "Connect failed", description: "Network error.", variant: "error" });
    } finally {
      setConnectingAssisted(false);
    }
  }

  async function simulateEvent(seatId?: string) {
    setSimulating(true);
    try {
      const uuidSeat =
        typeof seatId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seatId)
          ? seatId
          : undefined;
      const res = await fetch("/api/linkedin/simulate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: simType,
          profileUrl: simProfile,
          body: simType === "reply" ? simBody : "",
          seatId: uuidSeat,
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
        demo?: boolean;
        event?: LinkedInDemoChannelEvent;
      } | null;
      if (json?.status === "dry-run") {
        toast({ title: "Public demo only", description: json.detail, variant: "info" });
        return;
      }
      if (!json?.ok) {
        toast({ title: "Simulate failed", description: json?.error ?? `HTTP ${res.status}`, variant: "error" });
        return;
      }
      let duplicate = Boolean(json.duplicate);
      if ((json.demo || !supabaseEnabled) && json.event) {
        const written = appendLinkedInDemoEvent(json.event);
        duplicate = written.duplicate;
      }
      toast({
        title: `Simulated ${json.eventType ?? simType}`,
        description: duplicate
          ? "Duplicate event (idempotent)."
          : json.classifyQueued
            ? "Reply recorded — classify queued."
            : json.demo || !supabaseEnabled
              ? "Event written — open Replies → LinkedIn inbox."
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

  const oauthSeat = seats.find((s) => s.oauthConnected);
  const signedIn = Boolean(oauthSeat?.oauthProfile);

  const readinessItems: ReadinessItem[] = providers
    ? [
        {
          id: "oauth",
          label: "LinkedIn OAuth credentials",
          ok: providers.oauthConfigured,
          hint: "Attach a LinkedIn OIDC vault key + client id in Settings → LinkedIn (or set LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).",
        },
        {
          id: "encryption",
          label: "Token encryption",
          ok: providers.encryptionReady,
          hint: "DATA_ENCRYPTION_KEY (≥32 chars) must be configured.",
        },
        {
          id: "vendor",
          label: "Vendor API (contracted automation)",
          ok: providers.vendorApiConfigured,
          hint: "Attach LinkedIn Vendor API key + URL in Settings → LinkedIn (or LINKEDIN_VENDOR_* env).",
          optional: true,
        },
        {
          id: "browser",
          label: "Browser computer supervisor",
          ok: providers.browserComputerConfigured,
          hint: "Attach Computer Supervisor token + URL in Settings → LinkedIn (or COMPUTER_SUPERVISOR_* env).",
          optional: true,
        },
        {
          id: "webhook",
          label: "Inbound webhook secret",
          ok: providers.inboundWebhookSecret,
          hint: "Required for vendor reply events.",
        },
      ]
    : [];

  return {
    isAdmin,
    loading,
    connectingOAuth,
    connectingAssisted,
    testingSeat,
    label,
    setLabel,
    providers,
    seats,
    simProfile,
    setSimProfile,
    simBody,
    setSimBody,
    simType,
    setSimType,
    simulating,
    oauthSeat,
    signedIn,
    readinessItems,
    connectWithLinkedInOAuth,
    connectAssisted,
    simulateEvent,
    testSeat,
    actions,
    load,
  };
}

export function LinkedInIdentityStep({
  stepState,
  hideAdvanced,
}: {
  stepState?: StepState;
  hideAdvanced?: boolean;
}) {
  const {
    isAdmin,
    loading,
    connectingOAuth,
    connectingAssisted,
    testingSeat,
    label,
    setLabel,
    providers,
    seats,
    simProfile,
    setSimProfile,
    simBody,
    setSimBody,
    simType,
    setSimType,
    simulating,
    oauthSeat,
    signedIn,
    readinessItems,
    connectWithLinkedInOAuth,
    connectAssisted,
    simulateEvent,
    testSeat,
    actions,
    load,
  } = useLinkedInConnections();

  const state: StepState =
    stepState ?? (signedIn ? "complete" : providers?.oauthConfigured === false && supabaseEnabled ? "blocked" : "active");

  const advanced = hideAdvanced ? undefined : (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-ink">Assisted-manual without OAuth</p>
        <p className="mt-1 text-xs text-muted">
          Creates a messaging seat without LinkedIn Sign In. Prefer OAuth when credentials are configured.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Operator label" htmlFor="li-operator-label">
            <Input
              id="li-operator-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Alex Recruiter"
            />
          </Field>
          <Button size="sm" variant="outline" loading={connectingAssisted} onClick={() => void connectAssisted()}>
            Create assisted seat
          </Button>
        </div>
      </div>
      {isAdmin && (
        <div>
          <p className="text-xs font-medium text-ink">Simulate inbound event</p>
          <p className="mt-1 text-[11px] text-muted">
            Proves webhook → classify without a vendor. Does not call linkedin.com.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
            <Field label="Reply body" htmlFor="li-sim-body" className="mt-3">
              <Input id="li-sim-body" value={simBody} onChange={(e) => setSimBody(e.target.value)} />
            </Field>
          )}
          <Button
            size="sm"
            variant="subtle"
            className="mt-3"
            leftIcon={<Wand2 className="h-3.5 w-3.5" />}
            loading={simulating}
            onClick={() => void simulateEvent(seats[0]?.id)}
          >
            Simulate event
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <ConnectionStep
      step={1}
      title="Identity — Sign in with LinkedIn"
      subtitle="OpenID Connect login. We store encrypted tokens and your public profile — never your password."
      state={state}
      advanced={advanced}
    >
      {readinessItems.length > 0 ? <SystemReadiness items={readinessItems} /> : null}

      {signedIn && oauthSeat?.oauthProfile ? (
        <ConnectedIdentityBanner
          displayName={oauthSeat.oauthProfile.displayName}
          secondary={`${oauthSeat.oauthProfile.email ?? "No email from LinkedIn"} · connected ${new Date(oauthSeat.oauthProfile.connectedAt).toLocaleString()}`}
          imageUrl={oauthSeat.oauthProfile.pictureUrl}
          icon={<Linkedin className="h-5 w-5" aria-hidden />}
        />
      ) : null}

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            leftIcon={<Linkedin className="h-4 w-4" />}
            loading={connectingOAuth}
            disabled={!providers?.oauthConfigured && supabaseEnabled}
            onClick={() => void connectWithLinkedInOAuth()}
          >
            {signedIn ? "Reconnect LinkedIn" : "Sign in with LinkedIn"}
          </Button>
          {!providers?.oauthConfigured && supabaseEnabled ? (
            <p className="max-w-md text-xs text-muted">
              OAuth env vars missing — expand System readiness above for details.
            </p>
          ) : null}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted">Loading LinkedIn connection…</p>
      ) : seats.length === 0 ? (
        <p className="text-xs text-muted">No LinkedIn seat yet. Sign in above to create one.</p>
      ) : (
        <ul className="space-y-2">
          {seats.map((s, i) => {
            const ready = s.mode === "live" && s.status === "active";
            return (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <ConnectionListItem
                  title={s.name}
                  meta={`${s.oauthProfile?.displayName || s.connectedAccount || s.operatorEmail || "No identity"} · ${s.inboundRoute?.active ? "inbound route OK" : "inbound route missing"}`}
                  healthy={ready}
                  badges={
                    <>
                      {s.oauthConnected && (
                        <Badge tone="electric" size="sm">
                          OIDC
                        </Badge>
                      )}
                      <Badge tone="neutral" size="sm">
                        {s.provider}
                      </Badge>
                    </>
                  }
                  actions={
                    <>
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
                    </>
                  }
                />
              </motion.li>
            );
          })}
        </ul>
      )}
    </ConnectionStep>
  );
}

/** @deprecated Prefer LinkedInOutreachStack — kept for direct import compatibility */
export function LinkedInConnectionsPanel() {
  return <LinkedInIdentityStep />;
}
