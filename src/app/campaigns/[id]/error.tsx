"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/**
 * Route-segment error boundary for /campaigns/[id]. Catches render/runtime
 * errors thrown within a single campaign detail view so a broken campaign
 * page degrades to a recoverable panel instead of blanking the whole app.
 * Never surfaces error.message / stack to end users in production — the real
 * error is logged to the console for developers only.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
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
      <h1 className="display text-4xl text-ink">This campaign hit an unexpected error.</h1>
      <p className="mt-3 max-w-md text-muted">
        Aria couldn’t finish rendering this campaign. Your data is safe, so try again, or
        head back to the command center.
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
