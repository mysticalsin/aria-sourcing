"use client";

import { ariaBuildLabel, ariaBuildSha } from "@/lib/build-info";

/** Visible git SHA so Fly-show can prove which release is running. */
export function AriaBuildStamp({ className }: { className?: string }) {
  const sha = ariaBuildSha();
  return (
    <span data-testid="aria-build-sha" title={sha || "unreleased"} className={className}>
      aria {ariaBuildLabel()}
    </span>
  );
}
