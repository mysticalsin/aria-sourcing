"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useSeats } from "@/lib/store";
import { isBrowserComputerSeat } from "@/lib/campaign-seat-attach";
import { ConnectionStackShell } from "@/components/settings/integration-connection-primitives";
import { FleetHealthStrip } from "@/components/fleet/fleet-health-strip";

export const FLEET_ROSTER_STACK_ID = "fleet-roster-stack";

export function FleetRosterStack({ children }: { children: React.ReactNode }) {
  const seats = useSeats();

  const emailSeats = seats.filter((s) => !isBrowserComputerSeat(s));
  const liSeats = seats.filter(isBrowserComputerSeat);
  const withMailbox = emailSeats.filter((s) => s.connectedAccount).length;
  // Email-only live-ready — LI send-ready is FleetHealthStrip (sessionHealthy probe).
  const emailLiveReady = emailSeats.filter(
    (s) => s.mode === "live" && s.connectedAccount && s.domainVerified,
  ).length;

  // Step 3 is email send-ready only — never green from LI mode=live alone.
  const stepsComplete =
    (seats.length > 0 ? 1 : 0) +
    (withMailbox > 0 || liSeats.length > 0 ? 1 : 0) +
    (emailLiveReady > 0 ? 1 : 0);
  const progressPct = seats.length ? (stepsComplete / 3) * 100 : 0;

  let statusLabel = "No agents";
  let statusTone: "neutral" | "success" | "electric" | "warning" = "neutral";
  if (emailLiveReady > 0) {
    statusLabel = `${emailLiveReady} email ready to send`;
    statusTone = "success";
  } else if (liSeats.length > 0) {
    statusLabel = `${liSeats.length} LI desk${liSeats.length === 1 ? "" : "s"} · probe on strip`;
    statusTone = "electric";
  } else if (withMailbox > 0) {
    statusLabel = "Mailboxes linked";
    statusTone = "electric";
  } else if (emailSeats.length > 0) {
    statusLabel = "Needs mailbox";
    statusTone = "warning";
  } else if (seats.length > 0) {
    statusLabel = "Agents present";
    statusTone = "electric";
  }

  return (
    <ConnectionStackShell
      id={FLEET_ROSTER_STACK_ID}
      eyebrow="Agent fleet"
      title="Seats & mailboxes"
      description="Email seats need mailbox + domain verify. LinkedIn Browser Computer desks need Take→login→Release — the strip below never invents sessionHealthy."
      statusLabel={statusLabel}
      statusTone={statusTone}
      progressPct={progressPct}
      progressLabel={
        seats.length
          ? `${liSeats.length} LI · ${emailLiveReady} email live-ready · ${withMailbox} with mailbox · ${seats.length} total`
          : "Add your first agent to begin"
      }
      footer={
        <p className="flex flex-wrap items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          OAuth mailboxes:{" "}
          <Link href="/settings?tab=integrations" className="font-medium text-ink underline-offset-2 hover:underline">
            Settings → Integrations
          </Link>
          . LI session probe is on the readiness strip (never invent healthy).
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
