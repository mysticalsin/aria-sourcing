"use client";

import * as React from "react";
import { Users, Sparkles, CalendarCheck, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardBody, CardTitle, Eyebrow, Badge, Progress, EmptyState, Field, Input, Button, Switch } from "@/components/ui";
import { useActions, useBookings, useInterviewers, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { cn, initialsFrom, pluralize } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["Proposed", "Confirmed", "Completed"]);

export function InterviewerPanel() {
  const bookings = useBookings();
  const interviewers = useInterviewers();
  const actions = useActions();
  const isAdmin = can(useRole(), "manage_settings");

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("");
  const formId = React.useId();

  const { rows, nextUpEmail, totalLoad, activeCount } = React.useMemo(() => {
    const counts = new Map<string, number>();
    let active = 0;
    for (const b of bookings) {
      if (!ACTIVE_STATUSES.has(b.status) || !b.interviewerEmail) continue;
      active += 1;
      counts.set(b.interviewerEmail, (counts.get(b.interviewerEmail) ?? 0) + 1);
    }
    const activePool = interviewers.filter((iv) => iv.active);
    const built = interviewers.map((iv) => ({ ...iv, load: counts.get(iv.email) ?? 0 }));
    const maxLoad = built.reduce((m, r) => Math.max(m, r.load), 0);
    const next = activePool.length ? activePool[active % activePool.length] : null;
    return {
      rows: built.map((r) => ({ ...r, pct: maxLoad === 0 ? 0 : (r.load / maxLoad) * 100 })),
      nextUpEmail: next?.email ?? null,
      totalLoad: active,
      activeCount: activePool.length,
    };
  }, [bookings, interviewers]);

  const add = () => {
    if (!isAdmin || !name.trim() || !email.trim()) return;
    actions.addInterviewer({ name: name.trim(), email: email.trim(), role: role.trim() || undefined });
    setName("");
    setEmail("");
    setRole("");
  };

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Round-robin</Eyebrow>
          <CardTitle className="mt-1">Interviewer panel</CardTitle>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-aqua-soft text-aqua">
          <Users className="h-4 w-4" aria-hidden />
        </span>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
          {pluralize(totalLoad, "interview")} balanced across {pluralize(activeCount, "interviewer")}
        </p>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" aria-hidden />}
            title="No interviewers configured"
            description="Add interviewers below to enable round-robin scheduling."
          />
        ) : (
          <ul className="space-y-2.5">
            {rows.map((iv) => {
              const isNext = iv.active && iv.email === nextUpEmail;
              return (
                <li
                  key={iv.id}
                  className={cn(
                    "rounded-2xl border p-3.5 transition-colors",
                    !iv.active
                      ? "border-line bg-ink/[0.02] opacity-60"
                      : isNext
                        ? "border-tangerine/30 bg-tangerine-soft/60 ring-1 ring-inset ring-tangerine/20"
                        : "border-line bg-surface",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        isNext ? "bg-tangerine text-white" : "bg-ink/[0.06] text-ink-soft",
                      )}
                      aria-hidden
                    >
                      {initialsFrom(iv.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-bold text-ink">{iv.name}</span>
                        {isNext && (
                          <Badge tone="tangerine" size="sm">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            Next up
                          </Badge>
                        )}
                        {!iv.active && (
                          <Badge tone="neutral" size="sm">Inactive</Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted">{iv.role}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-lg font-extrabold tabular-nums text-ink">{iv.load}</div>
                      <div className="text-[0.6875rem] uppercase tracking-wide text-muted">load</div>
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Switch
                          id={`iv-active-${iv.id}`}
                          checked={iv.active}
                          onCheckedChange={(v) => actions.updateInterviewer(iv.id, { active: v })}
                          label={iv.active ? "Active" : "Inactive"}
                        />
                        <button
                          type="button"
                          onClick={() => actions.removeInterviewer(iv.id)}
                          aria-label={`Remove ${iv.name}`}
                          className="rounded-lg p-1.5 text-muted transition hover:bg-danger/10 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-2.5">
                    <Progress value={iv.pct} tone={isNext ? "tangerine" : "aqua"} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {isAdmin && (
          <div className="rounded-2xl border border-violet/10 bg-violet/[0.03] p-3.5">
            <p className="mb-2.5 text-xs font-semibold text-ink">Add interviewer</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field label="Name" htmlFor={`${formId}-name`}>
                <Input id={`${formId}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie Osei" />
              </Field>
              <Field label="Email" htmlFor={`${formId}-email`}>
                <Input id={`${formId}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jamie.osei@company.com" />
              </Field>
              <Field label="Role (optional)" htmlFor={`${formId}-role`} className="sm:col-span-2">
                <Input id={`${formId}-role`} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Engineering Manager" />
              </Field>
              <Button onClick={add} disabled={!name.trim() || !email.trim()} size="sm" className="sm:col-span-2">
                <Plus className="h-3.5 w-3.5" />
                Add interviewer
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
