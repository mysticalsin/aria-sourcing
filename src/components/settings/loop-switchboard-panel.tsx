"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Eyebrow,
  Switch,
  useToast,
} from "@/components/ui";
import { AlertTriangle, Power, Radio } from "lucide-react";

type LoopControls = {
  killSwitch: boolean;
  intakeEnabled: boolean;
  sourcingEnabled: boolean;
  enrichmentEnabled: boolean;
  sequencesEnabled: boolean;
  swarmEnabled: boolean;
  maxSourcingRunsPerDay: number;
  maxSequenceSendsPerDay: number;
  maxEnrichmentUnitsPerDay: number;
  updatedAt: string | null;
  armed: boolean;
};

const DEFAULTS: LoopControls = {
  killSwitch: true,
  intakeEnabled: false,
  sourcingEnabled: false,
  enrichmentEnabled: false,
  sequencesEnabled: false,
  swarmEnabled: false,
  maxSourcingRunsPerDay: 50,
  maxSequenceSendsPerDay: 200,
  maxEnrichmentUnitsPerDay: 1000,
  updatedAt: null,
  armed: false,
};

/**
 * Live workspace switchboard for the sourcing loop.
 * Env ARIA_LOOP_KILL_SWITCH=false is also required on the worker process —
 * this panel arms the per-workspace DB controls only.
 */
export function LoopSwitchboardPanel() {
  const { toast } = useToast();
  const [controls, setControls] = React.useState<LoopControls>(DEFAULTS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [demo, setDemo] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sourcing-loop/controls", {
        method: "GET",
        credentials: "include",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        demo?: boolean;
        controls?: LoopControls;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.controls) {
        setError(json.error ?? `Load failed (HTTP ${res.status}).`);
        return;
      }
      setDemo(json.demo === true);
      setControls(json.controls);
    } catch {
      setError("Could not reach loop controls.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save(next: LoopControls) {
    if (demo) {
      toast({
        title: "Demo mode",
        description: "Loop switchboard requires a live workspace.",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/sourcing-loop/controls", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          killSwitch: next.killSwitch,
          intakeEnabled: next.intakeEnabled,
          sourcingEnabled: next.sourcingEnabled,
          enrichmentEnabled: next.enrichmentEnabled,
          sequencesEnabled: next.sequencesEnabled,
          swarmEnabled: next.swarmEnabled,
          maxSourcingRunsPerDay: next.maxSourcingRunsPerDay,
          maxSequenceSendsPerDay: next.maxSequenceSendsPerDay,
          maxEnrichmentUnitsPerDay: next.maxEnrichmentUnitsPerDay,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        controls?: LoopControls;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.controls) {
        toast({
          title: "Switchboard not updated",
          description: json.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }
      setControls(json.controls);
      toast({
        title: json.controls.armed ? "Loop armed" : "Loop updated",
        description: json.controls.armed
          ? "Workspace controls armed — Fly loop process also needs ARIA_LOOP_KILL_SWITCH=false to run."
          : "Workspace controls saved (still fail-closed until armed).",
        variant: "success",
      });
    } catch {
      toast({ title: "Switchboard save failed", variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  function armEnterpriseLoop() {
    void save({
      ...controls,
      killSwitch: false,
      intakeEnabled: true,
      sourcingEnabled: true,
      enrichmentEnabled: true,
      sequencesEnabled: true,
      swarmEnabled: false,
    });
  }

  function engageKillSwitch() {
    void save({
      ...controls,
      killSwitch: true,
      intakeEnabled: false,
      sourcingEnabled: false,
      enrichmentEnabled: false,
      sequencesEnabled: false,
      swarmEnabled: false,
    });
  }

  return (
    <Card className="overflow-hidden border-line bg-gradient-to-br from-surface to-ink/[0.03]">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Eyebrow>Sourcing loop</Eyebrow>
            <p className="mt-1 text-sm font-semibold text-ink">Workspace switchboard</p>
            <p className="mt-1 max-w-xl text-xs text-muted">
              Webhook intake → parse → source → draft → send. With REI Autopilot
              enabled on a member profile and Sequences armed here, critic-green
              drafts auto-queue Email / WhatsApp / LinkedIn (HeyReach). Autopilot
              off keeps one-by-one human Approve → Send. Also set{" "}
              <code className="rounded bg-ink/[0.06] px-1 font-mono">ARIA_LOOP_KILL_SWITCH=false</code>{" "}
              on the Fly loop process.
            </p>
          </div>
          {loading ? (
            <Badge tone="neutral" size="sm">
              Loading…
            </Badge>
          ) : controls.armed ? (
            <Badge tone="success" size="sm" dot>
              Armed
            </Badge>
          ) : (
            <Badge tone="warning" size="sm" dot>
              Fail-closed
            </Badge>
          )}
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        <ul className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["Kill switch", controls.killSwitch, "Stops every loop stage for this workspace."],
              ["Intake", controls.intakeEnabled, "Allows hiring-need → requisition_parse enqueue."],
              ["Sourcing", controls.sourcingEnabled, "Allows sourcing batches and shortlist jobs."],
              ["Sequences", controls.sequencesEnabled, "Outreach drafts + autopilot send + calendar book when entitled."],
            ] as const
          ).map(([label, on, hint], i) => (
            <motion.li
              key={label}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface/80 px-3 py-2.5"
            >
              <div>
                <p className="text-sm font-semibold text-ink">{label}</p>
                <p className="text-[11px] text-muted">{hint}</p>
              </div>
              <Switch
                checked={on}
                disabled={loading || saving || demo}
                onCheckedChange={(v) => {
                  const next = { ...controls };
                  if (label === "Kill switch") {
                    next.killSwitch = v;
                    if (v) {
                      next.intakeEnabled = false;
                      next.sourcingEnabled = false;
                      next.enrichmentEnabled = false;
                      next.sequencesEnabled = false;
                      next.swarmEnabled = false;
                    }
                  } else if (label === "Intake") next.intakeEnabled = v;
                  else if (label === "Sourcing") next.sourcingEnabled = v;
                  else next.sequencesEnabled = v;
                  void save(next);
                }}
                aria-label={label}
              />
            </motion.li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={loading || saving || demo || controls.armed}
            onClick={armEnterpriseLoop}
          >
            <Power className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Arm enterprise loop
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={loading || saving || demo || controls.killSwitch}
            onClick={engageKillSwitch}
          >
            Engage kill switch
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={loading || saving} onClick={() => void load()}>
            <Radio className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
