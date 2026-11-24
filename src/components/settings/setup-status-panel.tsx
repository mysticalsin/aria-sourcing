"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent } from "@/components/ui";

type SetupStatus = { mode: string; ready: boolean; message: string; checks: { id: string; label: string; status: string; detail: string }[] };

export function SetupStatusPanel() {
  const [result, setResult] = React.useState<SetupStatus | null>(null);
  const [error, setError] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  async function check() {
    setChecking(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/setup/status", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Connection check failed.");
      setResult(body);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection check failed."); }
    finally { setChecking(false); }
  }
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold text-ink">Workspace readiness</h2><p className="text-sm text-muted">Verify the backend and see which connections still need setup.</p></div>
          <Button onClick={check} disabled={checking}>{checking ? "Checking…" : "Check connections"}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {result && <div aria-live="polite" className="space-y-3">
          <p className="text-sm text-muted">{result.message}</p>
          <Badge tone={result.ready ? "success" : "neutral"}>{result.ready ? "Core workspace ready" : result.mode === "synthetic" ? "Synthetic demo" : "Setup needs attention"}</Badge>
          {result.checks.map((item) => <div key={item.id} className="flex items-start justify-between gap-4 border-t border-line pt-3">
            <div><p className="text-sm font-semibold text-ink">{item.label}</p><p className="text-xs text-muted">{item.detail}</p></div>
            <Badge tone={item.status === "verified" ? "success" : item.status === "blocked" ? "warning" : "neutral"}>{item.status}</Badge>
          </div>)}
        </div>}
      </CardContent>
    </Card>
  );
}
