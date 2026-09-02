"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Field, Input, Switch, useConfirm, useToast } from "@/components/ui";
import { useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { LINKEDIN_DAILY_CONNECT_CAP, LINKEDIN_DAILY_MESSAGE_CAP } from "@/lib/linkedin-loop";
import { LINKEDIN_SENDING_OFF, type LinkedInSendingControls } from "@/lib/linkedin-caps";
import { ShieldAlert } from "lucide-react";

type Grant = {
  id: string;
  campaign_id: string;
  vendor_campaign_id: string | null;
  daily_cap: number;
  quiet_start: number;
  quiet_end: number;
  timezone: string;
  granted_at: string;
  revoked_at: string | null;
};

function clampCap(raw: string, ceiling: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(ceiling, Math.max(0, n));
}

function formatReset(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: false }).format(at);
  } catch {
    return "";
  }
}

/**
 * LinkedIn sending: the workspace daily limits, today's usage, the reply
 * loop switch and the kill switch. Aria sends from the operator's own
 * LinkedIn account only while the switch is on AND a campaign has a live
 * launch, and never past the two limits below. Off is the default.
 */
export function LinkedInLoopPanel() {
  const role = useRole();
  const { toast } = useToast();
  const confirm = useConfirm();
  const isAdmin = can(role, "manage_settings");
  const canRevoke = can(role, "outreach");
  const [controls, setControls] = React.useState<LinkedInSendingControls>(LINKEDIN_SENDING_OFF);
  const [grants, setGrants] = React.useState<Grant[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [messageCap, setMessageCap] = React.useState(String(LINKEDIN_DAILY_MESSAGE_CAP));
  const [connectCap, setConnectCap] = React.useState(String(LINKEDIN_DAILY_CONNECT_CAP));
  const messageCapId = React.useId();
  const connectCapId = React.useId();

  const load = React.useCallback(async () => {
    try {
      const [controlsRes, grantsRes] = await Promise.all([
        fetch("/api/outreach/linkedin-loop/controls"),
        fetch("/api/outreach/linkedin-loop/launch"),
      ]);
      const controlsJson = (await controlsRes.json().catch(() => null)) as Partial<LinkedInSendingControls> | null;
      if (controlsRes.ok && controlsJson) {
        const next: LinkedInSendingControls = {
          killSwitch: controlsJson.killSwitch !== false,
          enabled: controlsJson.enabled === true,
          persisted: controlsJson.persisted === true,
          messageCap: typeof controlsJson.messageCap === "number" ? controlsJson.messageCap : 0,
          connectCap: typeof controlsJson.connectCap === "number" ? controlsJson.connectCap : 0,
          timezone: typeof controlsJson.timezone === "string" && controlsJson.timezone ? controlsJson.timezone : "UTC",
          messagesToday: typeof controlsJson.messagesToday === "number" ? controlsJson.messagesToday : 0,
          connectsToday: typeof controlsJson.connectsToday === "number" ? controlsJson.connectsToday : 0,
          resetsAt: typeof controlsJson.resetsAt === "string" ? controlsJson.resetsAt : null,
        };
        setControls(next);
        setMessageCap(String(next.messageCap));
        setConnectCap(String(next.connectCap));
      }
      const grantsJson = (await grantsRes.json().catch(() => null)) as { grants?: Grant[] } | null;
      if (grantsRes.ok && Array.isArray(grantsJson?.grants)) setGrants(grantsJson.grants);
    } catch {
      setControls(LINKEDIN_SENDING_OFF);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function setEnabled(enabled: boolean, revokeAll = false) {
    if (!enabled) {
      const ok = await confirm({
        title: revokeAll ? "Stop everything?" : "Pause automatic LinkedIn replies?",
        description: revokeAll
          ? "Stop everything. Every queued message becomes a draft for a person. Campaigns must be launched again to resume."
          : "Queued replies wait as drafts until the loop is switched back on.",
        confirmLabel: revokeAll ? "Stop everything" : "Pause",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/outreach/linkedin-loop/controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, revokeAll }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; persisted?: boolean } | null;
      if (!res.ok || json?.ok !== true) {
        toast({ title: "Switch not changed", description: json?.error ?? "The server refused the change.", variant: "error" });
        return;
      }
      toast({
        title: enabled ? "LinkedIn reply loop on" : revokeAll ? "Everything stopped" : "LinkedIn reply loop paused",
        description: json.persisted === false ? "Demo: nothing persisted, the loop stays off." : undefined,
        variant: "success",
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveCaps() {
    const next = {
      messageCap: clampCap(messageCap, LINKEDIN_DAILY_MESSAGE_CAP),
      connectCap: clampCap(connectCap, LINKEDIN_DAILY_CONNECT_CAP),
    };
    setBusy(true);
    try {
      const res = await fetch("/api/outreach/linkedin-loop/controls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; persisted?: boolean } | null;
      if (!res.ok || json?.ok !== true) {
        toast({ title: "Limits not saved", description: json?.error ?? "The server refused the change.", variant: "error" });
        return;
      }
      toast({
        title: "Daily limits saved",
        description:
          json.persisted === false
            ? "Demo: nothing persisted."
            : `${next.messageCap} messages and ${next.connectCap} connection requests a day.`,
        variant: "success",
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(grant: Grant) {
    const ok = await confirm({
      title: `Revoke launch for ${grant.campaign_id}?`,
      description: "Replies for this campaign go back to a person. Launch again to resume.",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch("/api/outreach/linkedin-loop/launch", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantId: grant.id, reason: "revoked in settings" }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || json?.ok !== true) {
      toast({ title: "Launch not revoked", description: json?.error ?? "The server refused the change.", variant: "error" });
      return;
    }
    toast({ title: "Launch revoked", variant: "success" });
    await load();
  }

  const active = grants.filter((g) => !g.revoked_at);
  const live = !controls.killSwitch && controls.enabled;
  const resetTime = formatReset(controls.resetsAt, controls.timezone);
  const capsDirty =
    clampCap(messageCap, LINKEDIN_DAILY_MESSAGE_CAP) !== controls.messageCap ||
    clampCap(connectCap, LINKEDIN_DAILY_CONNECT_CAP) !== controls.connectCap;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-electric-soft text-electric">
                <ShieldAlert className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-ink">LinkedIn sending</div>
                <div className="text-xs text-muted">
                  After you launch a campaign, Aria sends connection requests and messages from your LinkedIn account, two to
                  ten minutes apart, within the limits below, until a meeting is booked.
                </div>
              </div>
            </div>
            <Badge tone={live ? "success" : "neutral"} dot>
              {controls.killSwitch ? "Workspace kill switch on" : live ? "On" : "Off"}
            </Badge>
          </div>

          <div className="rounded-2xl bg-ink/[0.03] p-4">
            <div className="text-sm text-ink">Daily limits</div>
            <p className="text-xs text-muted" data-testid="linkedin-usage-today">
              Today: {controls.messagesToday} of {controls.messageCap} messages, {controls.connectsToday} of {controls.connectCap}{" "}
              connection requests.
              {resetTime ? ` Resets at ${resetTime} ${controls.timezone}.` : ""}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Messages per day"
                htmlFor={messageCapId}
                hint={`0 to ${LINKEDIN_DAILY_MESSAGE_CAP}. First messages and replies together.`}
              >
                <Input
                  id={messageCapId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={LINKEDIN_DAILY_MESSAGE_CAP}
                  step={1}
                  value={messageCap}
                  disabled={!isAdmin || busy}
                  onChange={(e) => setMessageCap(e.target.value)}
                  onBlur={() => setMessageCap(String(clampCap(messageCap, LINKEDIN_DAILY_MESSAGE_CAP)))}
                />
              </Field>
              <Field
                label="Connection requests per day"
                htmlFor={connectCapId}
                hint={`0 to ${LINKEDIN_DAILY_CONNECT_CAP}. New people only.`}
              >
                <Input
                  id={connectCapId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={LINKEDIN_DAILY_CONNECT_CAP}
                  step={1}
                  value={connectCap}
                  disabled={!isAdmin || busy}
                  onChange={(e) => setConnectCap(e.target.value)}
                  onBlur={() => setConnectCap(String(clampCap(connectCap, LINKEDIN_DAILY_CONNECT_CAP)))}
                />
              </Field>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <Button variant="primary" size="sm" disabled={!isAdmin || busy || !capsDirty} onClick={() => void saveCaps()}>
                Save limits
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-2xl bg-ink/[0.03] p-4">
            <div className="text-sm text-ink">
              Reply loop
              <span className="block text-xs text-muted">
                {controls.killSwitch
                  ? "The workspace kill switch is engaged. Nothing sends until an admin clears it."
                  : "Off means every reply waits for a person. This is the safe default."}
              </span>
            </div>
            <Switch
              checked={live}
              disabled={!isAdmin || busy || controls.killSwitch}
              onCheckedChange={(v) => void setEnabled(v)}
              label="Automatic LinkedIn replies"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted">
              {active.length === 0
                ? "No campaign is launched. Launch one from Outreach to start sending."
                : `${active.length} launched campaign${active.length === 1 ? "" : "s"}.`}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">Stop everything. Every queued message becomes a draft for a person.</span>
              <Button variant="danger" size="sm" disabled={!isAdmin || busy} onClick={() => void setEnabled(false, true)}>
                Kill switch
              </Button>
            </div>
          </div>

          {active.length > 0 && (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {active.map((grant) => (
                <li key={grant.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{grant.campaign_id}</div>
                    <div className="text-xs text-muted">
                      Replies {grant.daily_cap} a day inside the workspace limit. Quiet {grant.quiet_start}:00 to {grant.quiet_end}:00{" "}
                      {grant.timezone}.
                      {grant.vendor_campaign_id ? ` LinkedIn campaign ${grant.vendor_campaign_id}.` : " Not linked to a LinkedIn campaign yet."}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" disabled={!canRevoke || busy} onClick={() => void revoke(grant)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
