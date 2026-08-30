"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/**
 * Root error boundary. Catches render/runtime errors thrown within the app
 * shell so a single broken view degrades to a recoverable panel instead of a
 * blank screen. Never surfaces error.message / stack to end users in production —
 * the real error is logged to the console for developers only.
 *
 * Most routes intentionally fall through to this generic boundary — the
 * sidebar/topbar still persist because AppShell wraps children above it in
 * layout.tsx, so nothing is broken by not having a bespoke one. Only a
 * handful of routes ship their own error.tsx, each naming the specific thing
 * that's likely to break in its scoped copy: /floor (heavy WebGL/three.js
 * office view), /fleet (seat mutation, LLM provider/model assignment,
 * allocation logic), /campaigns/[id] and /settings (single detail/config
 * views worth a page-specific recovery message), /soul (the persona editor),
 * /skills (the self-improvement/learning-proposal view), and /memory (the
 * per-agent memory panel). This is a deliberate, incremental scope decision,
 * not an unfinished rollout — add a bespoke boundary for a route once it has
 * a similarly concrete failure mode worth naming, not by default.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Always log — production Fly logs need the digest/message to diagnose
    // "Something broke" without a demo login. Never render message to the UI.
    console.error("[aria:error-boundary]", error.digest ?? "", error.message);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center text-center"
    >
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-ink text-paper">
        <TriangleAlert className="h-8 w-8 text-danger" />
      </div>
      <p className="eyebrow mb-2">Something broke</p>
      <h1 className="display text-4xl text-ink">This screen hit an unexpected error.</h1>
      <p className="mt-3 max-w-md text-muted">
        Aria couldn’t finish rendering this view. Your data is safe, so try again, or head
        back to the command center.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-muted/80">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-full bg-ink px-6 text-sm font-semibold text-paper shadow-soft transition-all duration-150 hover:bg-ink/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-6 text-sm font-semibold text-ink shadow-soft hover:bg-canvas"
        >
          Back to Command Center
        </Link>
      </div>
    </div>
  );
}
