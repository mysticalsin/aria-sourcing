"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, EmptyState, Field, Input, Select, Switch } from "@/components/ui";
import { useActions, useRole, useSchedules } from "@/lib/store";
import { CRON_CADENCES } from "@/lib/types";
import type { CronJob } from "@/lib/types";
import { can } from "@/lib/rbac";
import { CalendarClock, Plus, Trash2, Info } from "lucide-react";

const TASKS: { value: CronJob["task"]; label: string }[] = [
  { value: "sourcing", label: "Source candidates" },
  { value: "outreach", label: "Draft outreach" },
  { value: "report", label: "Generate report" },
];

const TASK_LABEL: Record<CronJob["task"], string> = {
  sourcing: "Source candidates",
  outreach: "Draft outreach",
  report: "Generate report",
};

/**
 * Admin surface for scheduled fleet jobs. Local CRUD over the persisted
 * `schedules` slice — the cadence/task define a recurring run the fleet would
 * perform. Each job still flows through the same approval gate when it acts.
 */
export function SchedulesPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_settings");
  const schedules = useSchedules();
  const actions = useActions();

  const [name, setName] = React.useState("");
  const [cadence, setCadence] = React.useState<CronJob["cadence"]>("daily");
  const [task, setTask] = React.useState<CronJob["task"]>("sourcing");
  const [timeOfDay, setTimeOfDay] = React.useState("09:00");
  const scheduleFormId = React.useId();

  const add = () => {
    if (!isAdmin || !name.trim()) return;
    actions.addSchedule({ name: name.trim(), cadence, task, timeOfDay, enabled: true });
    setName("");
  };

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-2">
          <Badge tone="electric" size="sm" dot>
            {schedules.filter((s) => s.enabled).length} active
          </Badge>
          <span className="text-xs text-muted">
            of {schedules.length} jobs · recurring fleet runs, approval-gated when they act
          </span>
        </div>

        {/* Honest state: jobs persist, but a scheduler/executor isn't running in this
            environment. They define intent; they fire automatically only once a backend
            runner (Supabase + a cron worker) is connected. */}
        <div className="flex items-start gap-2 rounded-xl border border-mantu-yellow/30 bg-mantu-yellow/[0.07] px-3.5 py-2.5 text-xs text-ink-soft">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mantu-yellow" aria-hidden />
          <span>
            Jobs are saved here, but automatic execution needs a connected backend runner
            (Supabase + a cron worker). Until that&rsquo;s wired, schedules stay configured.
            Run sourcing, outreach, or reports manually from the fleet meanwhile.
          </span>
        </div>

        {/* Existing jobs */}
        {schedules.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-7 w-7" />}
            title="No scheduled jobs"
            description="Add a recurring sourcing, outreach, or report run below."
          />
        ) : (
          <div className="divide-y divide-line rounded-2xl border border-line">
            {schedules.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{job.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge tone="neutral" size="sm">{job.cadence}</Badge>
                    {job.timeOfDay && <span className="tabular-nums">{job.timeOfDay}</span>}
                    <span>·</span>
                    <span>{TASK_LABEL[job.task]}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Switch
                    id={`sched-${job.id}`}
                    checked={job.enabled}
                    onCheckedChange={() => isAdmin && actions.toggleSchedule(job.id)}
                    label={job.enabled ? "Enabled" : "Paused"}
                    disabled={!isAdmin}
                  />
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => actions.removeSchedule(job.id)}
                      aria-label={`Delete ${job.name}`}
                      className="rounded-lg p-1.5 text-muted transition hover:bg-danger/10 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add job */}
        {isAdmin ? (
          <div className="rounded-2xl border border-violet/10 bg-violet/[0.03] p-4">
            <p className="mb-3 text-sm font-semibold text-ink">New scheduled job</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Name" htmlFor={`${scheduleFormId}-name`} className="sm:col-span-2">
                <Input
                  id={`${scheduleFormId}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nightly sourcing sweep"
                />
              </Field>
              <Field label="Cadence" htmlFor={`${scheduleFormId}-cadence`}>
                <Select
                  id={`${scheduleFormId}-cadence`}
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as CronJob["cadence"])}
                  options={CRON_CADENCES.map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Time" htmlFor={`${scheduleFormId}-time`}>
                <Input id={`${scheduleFormId}-time`} type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
              </Field>
              <Field label="Task" htmlFor={`${scheduleFormId}-task`} className="sm:col-span-2">
                <Select
                  id={`${scheduleFormId}-task`}
                  value={task}
                  onChange={(e) => setTask(e.target.value as CronJob["task"])}
                  options={TASKS}
                />
              </Field>
              <div className="flex items-end sm:col-span-2">
                <Button onClick={add} disabled={!name.trim()} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Add job
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">Admins only. Contact your workspace admin to manage schedules.</p>
        )}
      </CardContent>
    </Card>
  );
}
