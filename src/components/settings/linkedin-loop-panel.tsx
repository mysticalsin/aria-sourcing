"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Switch, useConfirm, useToast } from "@/components/ui";
import { useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { ShieldAlert } from "lucide-react";

type Controls = { killSwitch: boolean; enabled: boolean; persisted: boolean };
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

const OFF: Controls = { killSwitch: true, enabled: false, persisted: false };

/**
 * Kill switch and launch list for the LinkedIn reply loop. The loop answers
 * candidate replies on its own only while this switch is on AND a campaign
 * has a live launch grant. Off is the default.
 */
export function LinkedInLoopPanel() {
  const role = useRole();
  const { toast } = useToast();
  const confirm = useConfirm();
  const isAdmin = can(role, "manage_settings");
  const canRevoke = can(role, "outreach");
  const [controls, setControls] = React.useState<Controls>(OFF);
  const [grants, setGrants] = React.useState<Grant[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [controlsRes, grantsRes] = await Promise.all([
        fetch("/api/outreach/linkedin-loop/controls"),
        fetch("/api/outreach/linkedin-loop/launch"),
      ]);
      const controlsJson = (await controlsRes.json().catch(() => null)) as Partial<Controls> | null;
      if (controlsRes.ok && controlsJson) {
        setControls({
          killSwitch: controlsJson.killSwitch !== false,
          enabled: controlsJson.enabled === true,
          persisted: controlsJson.persisted === true,
        });
      }
      const grantsJson = (await grantsRes.json().catch(() => null)) as { grants?: Grant[] } | null;
      if (grantsRes.ok && Array.isArray(grantsJson?.grants)) setGrants(grantsJson.grants);
    } catch {
      setControls(OFF);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function setEnabled(enabled: boolean, revokeAll = false) {
    if (!enabled) {
      const ok = await confirm({
        title: revokeAll ? "Stop the loop and revoke every launch?" : "Pause automatic LinkedIn replies?",
        description: revokeAll
          ? "Every queued reply becomes a draft for a person. Campaigns must be launched again to resume."
          : "Queued replies wait as drafts until the loop is switched back on.",
        confirmLabel: revokeAll ? "Kill" : "Pause",
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
        title: enabled ? "LinkedIn reply loop on" : revokeAll ? "Loop killed" : "LinkedIn reply loop paused",
        description: json.persisted === false ? "Demo: nothing persisted, the loop stays off." : undefined,
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
                <div className="text-sm font-semibold text-ink">Automatic LinkedIn replies</div>
                <div className="text-xs text-muted">
                  After you launch a campaign, Aria answers replies as you, two to ten minutes later, until a meeting is booked.
                </div>
              </div>
            </div>
            <Badge tone={live ? "success" : "neutral"} dot>
              {controls.killSwitch ? "Workspace kill switch on" : live ? "On" : "Off"}
            </Badge>
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
                ? "No campaign is launched. Launch one from Outreach to start the loop."
                : `${active.length} launched campaign${active.length === 1 ? "" : "s"}.`}
            </div>
            <Button variant="danger" size="sm" disabled={!isAdmin || busy} onClick={() => void setEnabled(false, true)}>
              Kill switch
            </Button>
          </div>

          {active.length > 0 && (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {active.map((grant) => (
                <li key={grant.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{grant.campaign_id}</div>
                    <div className="text-xs text-muted">
                      Cap {grant.daily_cap} a day. Quiet {grant.quiet_start}:00 to {grant.quiet_end}:00 {grant.timezone}.
                      {grant.vendor_campaign_id ? ` Vendor campaign ${grant.vendor_campaign_id}.` : " No vendor campaign id yet."}
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
