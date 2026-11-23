"use client";

import * as React from "react";
import { Briefcase, ExternalLink } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { odooApi, type OdooJobSummary } from "./api";

/**
 * Modal listing Odoo's open job positions. `onPick` receives the chosen job;
 * the caller decides what to do with it (import a brief, link a campaign).
 */
export function OdooJobPicker({
  open,
  onClose,
  onPick,
  title,
  description,
  confirmLabel,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (job: OdooJobSummary) => void | Promise<void>;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
}) {
  const [jobs, setJobs] = React.useState<OdooJobSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setJobs(null);
    setError(null);
    setSelected(null);
    void odooApi<{ jobs: OdooJobSummary[] }>("/jobs").then((res) => {
      if (cancelled) return;
      if (res.ok) setJobs(res.data.jobs);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chosen = jobs?.find((job) => job.id === selected) ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!chosen} loading={busy} onClick={() => chosen && void onPick(chosen)}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : jobs === null ? (
        <p className="text-sm text-muted">Reading the open job positions from Odoo…</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-muted">Odoo has no open job position. Create one in Odoo Recruitment first.</p>
      ) : (
        <ul role="listbox" aria-label="Odoo job positions" className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-2xl border border-line">
          {jobs.map((job) => (
            <li
              key={job.id}
              role="option"
              aria-selected={selected === job.id}
              className={cn("flex items-center gap-3 pr-4 transition-colors", selected === job.id ? "bg-electric-soft/60" : "hover:bg-ink/[0.04]")}
            >
              <button type="button" onClick={() => setSelected(job.id)} className="flex min-w-0 flex-1 items-center px-4 py-3 text-left">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Briefcase className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{job.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[job.department, job.openings ? `${job.openings} to hire` : "", job.applicationCount !== null ? `${job.applicationCount} applications` : ""]
                        .filter(Boolean)
                        .join(" · ") || "No department"}
                    </span>
                  </span>
                </span>
              </button>
              <a
                href={job.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-muted hover:text-ink"
                aria-label={`Open ${job.name} in Odoo`}
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
