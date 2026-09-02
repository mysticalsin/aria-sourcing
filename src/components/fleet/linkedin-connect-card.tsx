"use client";

import * as React from "react";
import { Badge, Button } from "@/components/ui";
import { supabaseEnabled } from "@/lib/supabase/config";
import {
  LINKEDIN_CARD_TITLE,
  LINKEDIN_SENDER_ENDPOINT,
  linkedInCardCopy,
  linkedInCardState,
  sendingEnabledFromResponse,
  type LinkedInCardState,
} from "@/lib/linkedin-connect-card";
import type { AgentSeat } from "@/lib/types";
import type { Tone } from "@/lib/utils";
import { Link2, Link2Off, PauseCircle, ShieldCheck } from "lucide-react";

const STATE_TONE: Record<LinkedInCardState, Tone> = {
  "not-enabled": "neutral",
  "not-connected": "neutral",
  connecting: "warning",
  connected: "success",
  restricted: "warning",
};

const STATE_LABEL: Record<LinkedInCardState, string> = {
  "not-enabled": "Not enabled",
  "not-connected": "Not connected",
  connecting: "Connecting",
  connected: "Connected",
  restricted: "Paused",
};

/**
 * The Connect LinkedIn card, section 2.1 of the plan. Reads one server fact
 * (is sending enabled here) and two seat facts (sender state, signed-in
 * account). Until the server answers, the card is "not enabled".
 */
export function LinkedInConnectCard({
  seat,
  canManage,
  onConnect,
  onDisconnect,
}: {
  seat: Pick<AgentSeat, "connectedAccount" | "providerState">;
  canManage: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const [sendingEnabled, setSendingEnabled] = React.useState<boolean | null>(supabaseEnabled ? null : false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!supabaseEnabled) return;
    let cancelled = false;
    fetch(LINKEDIN_SENDER_ENDPOINT, { cache: "no-store" })
      .then((res) => res.json().catch(() => null))
      .then((body) => {
        if (!cancelled) setSendingEnabled(sendingEnabledFromResponse(body));
      })
      .catch(() => {
        if (!cancelled) setSendingEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const state = linkedInCardState({
    sendingEnabled,
    providerState: seat.providerState,
    connectedAccount: seat.connectedAccount,
  });
  const copy = linkedInCardCopy(state, seat.connectedAccount);

  async function handleButton() {
    if (copy.button === "Connect LinkedIn") {
      onConnect();
      return;
    }
    setBusy(true);
    try {
      // Disconnect clears the seat on the server. Retry does the same, then
      // starts the connection again from the sign-in step.
      await onDisconnect();
      if (copy.button === "Retry connection") onConnect();
    } finally {
      setBusy(false);
    }
  }

  const Icon = state === "connected" ? Link2 : state === "restricted" ? PauseCircle : Link2Off;

  return (
    <div className="rounded-2xl bg-canvas px-3 py-2.5" data-testid="linkedin-connect-card" data-state={state}>
      <div className="flex items-start gap-2">
        <Icon
          className={
            state === "connected"
              ? "mt-0.5 h-4 w-4 shrink-0 text-success"
              : state === "restricted"
                ? "mt-0.5 h-4 w-4 shrink-0 text-warning"
                : "mt-0.5 h-4 w-4 shrink-0 text-muted"
          }
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{LINKEDIN_CARD_TITLE}</p>
          <p className="text-sm font-semibold text-ink">{copy.headline}</p>
          <p className="text-xs text-muted">{copy.detail}</p>
        </div>
        <Badge tone={STATE_TONE[state]} size="sm" className="ml-auto shrink-0">
          {STATE_LABEL[state]}
        </Badge>
      </div>
      {copy.button && canManage && (
        <Button
          variant={copy.button === "Disconnect" ? "outline" : "primary"}
          size="sm"
          className="mt-2 w-full"
          leftIcon={<ShieldCheck className="h-4 w-4" />}
          disabled={copy.buttonDisabled}
          loading={busy}
          onClick={handleButton}
        >
          {copy.button}
        </Button>
      )}
      {state === "connecting" && canManage && (
        <Button variant="ghost" size="sm" className="mt-1 w-full" loading={busy} onClick={() => void onDisconnect()}>
          Disconnect
        </Button>
      )}
    </div>
  );
}
