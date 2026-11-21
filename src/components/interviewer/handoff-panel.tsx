"use client";

import * as React from "react";

export function VoiceScreeningHandoff({
  enabled,
  context,
}: {
  enabled: boolean;
  context: "interviewer" | "calendar" | "candidate";
}) {
  const [ready, setReady] = React.useState(false);
  if (!enabled) {
    const disabledId = context === "interviewer" ? "interviewer-disabled" : `${context}-handoff-disabled`;
    return (
      <section data-testid={disabledId} className="mb-6 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold text-ink">Voice screening is off</h2>
        <p className="mt-1 text-sm text-muted">No screening request is sent.</p>
      </section>
    );
  }
  return (
    <section data-testid={`${context}-handoff`} className="mb-6 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-sm font-bold text-ink">Voice screening</h2>
      <p className="mt-1 text-sm text-muted">Preparing a hand-off does not change the candidate stage.</p>
      <button
        type="button"
        data-testid={`${context}-handoff-action`}
        className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper"
        onClick={() => setReady(true)}
      >
        Prepare screening hand-off
      </button>
      {ready ? (
        <p data-testid={`${context}-handoff-ready`} className="mt-2 text-sm text-ink">
          Hand-off prepared. The stage is unchanged.
        </p>
      ) : null}
    </section>
  );
}
