"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import {
  CommandHireEmployeeId,
  commandHireEmployeeId,
} from "@/components/hire/command-hire-employee-id";
import type { CandidateListRow } from "@/lib/candidate-list-hire";
import type { SourcingScreen } from "@/lib/sourcing-screen-hire";

export interface SourcingHireCandidate {
  id: string;
  name: string;
  email?: string;
  jobName: string;
}

interface ShownHire {
  ok?: boolean;
  erp?: string;
  linkedIn?: boolean;
  transport?: string;
  vacancyClose?: unknown;
  vacancyKwargs?: unknown;
  hrJobStateSent?: boolean;
  error?: string;
  steps?: { action: string; skipped?: boolean; ok?: boolean }[];
  unset?: { ok?: boolean; erp?: string; linkedIn?: boolean; fetchCount?: number };
  connectors?: { erp?: string; hired?: boolean; ok?: boolean; linkedIn?: boolean; hosts?: string[] }[];
}

function hireKey(screen: SourcingScreen, id: string): string {
  const raw = `${screen}-${id}`.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 80);
  return raw.length > 0 ? raw : `${screen}-hire`;
}

function usableEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return undefined;
  return trimmed;
}

/** One hire action for a sourcing screen. Fixture env shows SMART, API, MCP, and unset. */
export function SourcingHirePanel({
  screen,
  candidate,
  label,
  storedHire = null,
  onEmployeeId,
}: {
  screen: SourcingScreen;
  candidate: SourcingHireCandidate | null;
  label: string;
  /** In-memory hire already stored on the command center candidate. Display only. */
  storedHire?: CandidateListRow | null;
  /** Called with the positive hr.employee id a generic API or MCP hire returned. */
  onEmployeeId?: (candidateId: string, employeeId: number) => void;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ShownHire | null>(null);

  async function run() {
    if (!candidate || pending) return;
    const candidateId = candidate.id;
    setPending(true);
    setResult(null);
    try {
      const email = usableEmail(candidate.email);
      const response = await fetch("/api/hire/sourcing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          screen,
          idempotencyKey: hireKey(screen, candidate.id),
          job: { name: candidate.jobName },
          applicant: email ? { name: candidate.name, email } : { name: candidate.name },
          stage: "Hired",
        }),
      });
      const json = (await response.json()) as ShownHire & { employeeId?: unknown };
      setResult(json);
      const returnedId = json.employeeId;
      if (typeof returnedId === "number" && Number.isSafeInteger(returnedId) && returnedId > 0) {
        onEmployeeId?.(candidateId, returnedId);
      }
    } catch {
      setResult({ ok: false, erp: "skipped", error: "Hire request failed." });
    } finally {
      setPending(false);
    }
  }

  const employeeId = screen === "command" ? commandHireEmployeeId(storedHire, result) : null;
  const shownBase =
    result?.transport === "fixture"
      ? {
          ok: result.ok ?? false,
          transport: "fixture" as const,
          linkedIn: result.linkedIn ?? false,
          unset: {
            ok: result.unset?.ok ?? false,
            erp: result.unset?.erp ?? "skipped",
            linkedIn: result.unset?.linkedIn ?? false,
            fetchCount: result.unset?.fetchCount ?? 0,
          },
          connectors: (result.connectors ?? []).map((connector) => ({
            erp: connector.erp,
            hired: connector.hired ?? false,
            ok: connector.ok ?? false,
            linkedIn: connector.linkedIn ?? false,
            hosts: connector.hosts ?? [],
          })),
          error: result.error,
        }
      : result
        ? {
            ok: result.ok ?? false,
            erp: result.erp ?? "skipped",
            linkedIn: result.linkedIn ?? false,
            transport: result.transport ?? "live",
            steps: (result.steps ?? []).map((step) => step.action).join(","),
            vacancyClose: result.vacancyClose ?? null,
            hrJobStateSent: result.hrJobStateSent ?? false,
            error: result.error,
          }
        : null;
  const shown = shownBase == null || employeeId == null ? shownBase : { ...shownBase, employeeId };

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" data-testid={`sourcing-hire-${screen}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{label}</p>
          <p className="mt-1 text-sm text-muted">
            {candidate ? `${candidate.name} · ${candidate.jobName}` : "No candidate on this screen yet."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!candidate || pending}
          onClick={run}
          data-testid={`sourcing-hire-${screen}-run`}
        >
          {pending ? "Hiring…" : "Hire into ERP"}
        </Button>
      </div>
      {screen === "command" ? <CommandHireEmployeeId candidate={storedHire} result={result} /> : null}
      {shown ? (
        <pre
          className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-ink/[0.04] p-3 text-sm text-ink"
          data-testid={`sourcing-hire-${screen}-result`}
        >
          {JSON.stringify(shown, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
