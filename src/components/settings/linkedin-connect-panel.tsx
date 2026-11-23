"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent } from "@/components/ui";

type ConnectHalf = {
  connected: boolean;
  reason: string | null;
  endpointHost: string | null;
};

type ConnectStatus = {
  ok: true;
  recruiterSystemConnect: ConnectHalf;
  tokenChannel: ConnectHalf & { exactTextApproval: boolean };
};

type Sourced = {
  name: string;
  role: string;
  location: string;
  source: string;
};

const REASON_COPY: Record<string, string> = {
  "not-configured": "Not connected. Sourcing still runs from the workspace.",
  "off-by-default": "Off until a server operator sets it. Sourcing does not depend on it.",
  "missing-token": "The server has no bearer token, so this stays not connected.",
  "refused-page-url":
    "That address is a linkedin.com page. Recruiter System Connect needs an HTTPS API endpoint, not a LinkedIn page.",
  "refused-insecure": "The endpoint must be HTTPS. An insecure address is refused.",
  "refused-invalid-url": "The endpoint is not a valid URL. It is refused.",
};

function reasonCopy(reason: string | null): string {
  if (!reason) return "";
  return REASON_COPY[reason] ?? "Not connected.";
}

export function LinkedInConnectPanel() {
  const [status, setStatus] = React.useState<ConnectStatus | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [results, setResults] = React.useState<Sourced[]>([]);
  const [sourcing, setSourcing] = React.useState(false);
  const [sourceNote, setSourceNote] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/linkedin/connect", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("status");
        return (await response.json()) as ConnectStatus;
      })
      .then((body) => {
        if (!cancelled) setStatus(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function sourceCandidates() {
    setSourcing(true);
    try {
      const response = await fetch("/api/linkedin/rsc/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "staff engineer paris", count: 5 }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        linkedIn?: boolean;
        candidates?: Sourced[];
      };
      if (!response.ok || body.ok !== true) {
        setSourceNote("Sourcing could not run.");
        setResults([]);
        return;
      }
      setResults(body.candidates ?? []);
      setSourceNote(
        body.linkedIn
          ? "Workspace candidates plus Recruiter System Connect results."
          : "LinkedIn is not connected. Workspace candidates are still here.",
      );
    } catch {
      setSourceNote("Sourcing could not run.");
      setResults([]);
    } finally {
      setSourcing(false);
    }
  }

  const rsc = status?.recruiterSystemConnect;
  const channel = status?.tokenChannel;
  const rscLabel = rsc ? (rsc.connected ? "Connected" : "Not connected") : loadError ? "Unavailable" : "Checking";
  const channelLabel = channel
    ? channel.connected
      ? "Connected"
      : "Not connected"
    : loadError
      ? "Unavailable"
      : "Checking";

  return (
    <Card>
      <CardContent className="space-y-4">
        <div id="linkedin-rsc-connect" data-testid="linkedin-rsc-connect" className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-base font-bold text-ink">LinkedIn Recruiter System Connect</h3>
            <p className="text-sm leading-relaxed text-ink-soft">
              This is LinkedIn&apos;s official recruiter API. Aria calls it only when the server already has
              an HTTPS endpoint and a bearer token in LINKEDIN_RSC_URL and LINKEDIN_RSC_TOKEN. This page
              never asks for that token and never shows it. A linkedin.com page address is refused. Sourcing
              keeps working when LinkedIn is not connected.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={rsc?.connected ? "success" : "neutral"} dot>
              <span data-testid="linkedin-rsc-state">{rscLabel}</span>
            </Badge>
            {rsc?.connected && rsc.endpointHost ? (
              <span className="text-xs text-muted">API host {rsc.endpointHost}</span>
            ) : null}
          </div>
          {rsc && !rsc.connected ? <p className="text-sm text-ink-soft">{reasonCopy(rsc.reason)}</p> : null}

          <div className="rounded-2xl bg-canvas px-3 py-3">
            <p className="text-sm font-semibold text-ink">LinkedIn token channel</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              This channel stays off unless the server sets LINKEDIN_VENDOR_API_URL and LINKEDIN_VENDOR_API_KEY.
              A send still waits for a human to approve the exact message text. The key is not shown here.
            </p>
            <div className="mt-2">
              <Badge tone={channel?.connected ? "success" : "neutral"} size="sm" dot>
                <span data-testid="linkedin-token-channel-state">{channelLabel}</span>
              </Badge>
            </div>
            {channel && !channel.connected ? (
              <p className="mt-2 text-xs text-muted">{reasonCopy(channel.reason)}</p>
            ) : null}
            {channel?.exactTextApproval ? (
              <p className="mt-2 text-xs text-muted" data-testid="linkedin-exact-text-approval">
                Exact-text approval is required before any token-channel send.
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={sourcing}
            data-testid="linkedin-rsc-source"
            onClick={() => void sourceCandidates()}
          >
            Source candidates
          </Button>
          {sourceNote ? (
            <p className="text-sm text-ink-soft" data-testid="linkedin-rsc-source-note">
              {sourceNote}
            </p>
          ) : null}
          {results.length > 0 ? (
            <ul className="space-y-2" data-testid="linkedin-rsc-results">
              {results.map((candidate) => (
                <li
                  key={`${candidate.source}:${candidate.name}`}
                  data-testid="linkedin-rsc-candidate"
                  className="rounded-2xl border border-line px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-ink">{candidate.name}</span>
                  <span className="text-ink-soft">
                    {" "}
                    · {candidate.role || "Role in profile text"} · {candidate.location} · {candidate.source}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
