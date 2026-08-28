"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useSeats } from "@/lib/store";
import { ConnectionStackShell } from "@/components/settings/integration-connection-primitives";
import { FleetHealthStrip } from "@/components/fleet/fleet-health-strip";

export const FLEET_ROSTER_STACK_ID = "fleet-roster-stack";

export function FleetRosterStack({ children }: { children: React.ReactNode }) {
  const seats = useSeats();

  const withMailbox = seats.filter((s) => s.connectedAccount).length;
  const liveReady = seats.filter(
    (s) => s.mode === "live" && s.connectedAccount && s.domainVerified,
  ).length;

  const stepsComplete =
    (seats.length > 0 ? 1 : 0) + (withMailbox > 0 ? 1 : 0) + (liveReady > 0 ? 1 : 0);
  const progressPct = seats.length ? (stepsComplete / 3) * 100 : 0;

  let statusLabel = "No agents";
  let statusTone: "neutral" | "success" | "electric" | "warning" = "neutral";
  if (liveReady > 0) {
    statusLabel = `${liveReady} live mailbox ready`;
    statusTone = "success";
  } else if (withMailbox > 0) {
    statusLabel = "Mailboxes linked";
    statusTone = "electric";
  } else if (seats.length > 0) {
    statusLabel = "Needs mailbox";
    statusTone = "warning";
  }

  return (
    <ConnectionStackShell
      id={FLEET_ROSTER_STACK_ID}
      eyebrow="Agent fleet"
      title="Seats & mailboxes"
      description="Each agent is one authorized mailbox under shared guardrails. Connect in Settings or per-seat below, verify domain, then go live."
      statusLabel={statusLabel}
      statusTone={statusTone}
      progressPct={progressPct}
      progressLabel={
        seats.length
          ? `${liveReady} live-ready · ${withMailbox} with mailbox · ${seats.length} total`
          : "Add your first agent to begin"
      }
      footer={
        <p className="flex flex-wrap items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          OAuth mailboxes:{" "}
          <Link href="/settings?tab=integrations" className="font-medium text-ink underline-offset-2 hover:underline">
            Settings → Integrations
          </Link>
          . Warm-up, caps, and suppression apply fleet-wide.
        </p>
      }
    >
      <div className="px-6 py-5 sm:px-8">
        <FleetHealthStrip />
      </div>
      <div className="px-6 pb-6 sm:px-8">{children}</div>
    </ConnectionStackShell>
  );
}
