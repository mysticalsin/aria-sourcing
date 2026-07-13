"use client";

import * as React from "react";
import type { WorkspaceStatus } from "@/lib/workspace-status";

interface WorkspaceStatusPanelProps {
  status: Exclude<WorkspaceStatus, { phase: "ready" }>;
  onRetryWorkspace: () => Promise<void>;
  onRetrySave: () => Promise<void>;
}

export function WorkspaceStatusPanel({
  status,
  onRetryWorkspace,
  onRetrySave,
}: WorkspaceStatusPanelProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    panelRef.current?.focus();
  }, [status.phase]);

  const runRetry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await (status.phase === "unsaved" ? onRetrySave() : onRetryWorkspace());
    } finally {
      setBusy(false);
    }
  };

  if (status.phase === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-paper px-6" aria-busy="true">
        <div
          ref={panelRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="w-full max-w-xl rounded-[2rem] border border-violet/15 bg-white p-8 text-center shadow-card outline-none"
        >
          <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-violet/15 border-t-violet" />
          <h1 className="text-2xl font-bold text-ink">
            {status.mode === "demo" ? "Loading demo workspace" : "Connecting to your workspace"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Product data and actions remain unavailable until the workspace is verified.
          </p>
        </div>
      </main>
    );
  }

  const signedOut = status.phase === "signed_out";
  const unsaved = status.phase === "unsaved";
  const title = signedOut
    ? "Your session has ended"
    : unsaved
      ? "Changes are not saved"
      : "Workspace temporarily unavailable";
  const message = signedOut
    ? "Sign in again to load your workspace. No demo or empty workspace has been substituted."
    : status.message;

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="alert"
        aria-live="assertive"
        className="w-full max-w-xl rounded-[2rem] border border-violet/15 bg-white p-8 shadow-card outline-none sm:p-10"
      >
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet">Aria workspace</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-4 text-sm leading-6 text-ink-soft">{message}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {signedOut ? (
            <a
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-violet px-5 py-3 text-sm font-bold text-white transition hover:bg-violet/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2"
            >
              Sign in
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void runRetry()}
              disabled={busy}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-violet px-5 py-3 text-sm font-bold text-white transition hover:bg-violet/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Retrying…" : unsaved ? "Retry saving" : "Retry"}
            </button>
          )}
          <a
            href="/auth/signout"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-violet/20 px-5 py-3 text-sm font-bold text-ink transition hover:bg-violet/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2"
          >
            Sign out
          </a>
        </div>
      </div>
    </main>
  );
}
