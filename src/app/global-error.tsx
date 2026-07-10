"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import "@/styles/globals.css";

/**
 * Root error boundary. Replaces the root layout when an error escapes it, so it
 * must render its own <html>/<body>. globals.css is imported here because the
 * failed root layout never applied it. Like error.tsx, the real error is logged
 * to the console for developers only and never shown to end users in production.
 */
export default function GlobalError({
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
    <html lang="en">
      <body className="antialiased">
        <div
          role="alert"
          className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
        >
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-ink text-paper">
            <TriangleAlert className="h-8 w-8 text-danger" />
          </div>
          <p className="eyebrow mb-2">Something broke</p>
          <h1 className="display text-4xl text-ink">Aria ran into a critical error.</h1>
          <p className="mt-3 max-w-md text-muted">
            The application failed to load. This one’s on us: reloading usually clears it.
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
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error replaces
                the root layout on catastrophic failure, so it must not depend on next/link's
                router context working; a plain anchor is the deliberate, safe fallback here. */}
            <a
              href="/"
              className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-6 text-sm font-semibold text-ink shadow-soft hover:bg-canvas"
            >
              Back to Command Center
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
