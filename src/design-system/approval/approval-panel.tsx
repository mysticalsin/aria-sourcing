"use client";

import { Segmented } from "../primitives/segmented";
import {
  DEFAULT_SEND_MODE,
  EXACT_OUTREACH_MESSAGE,
  EXACT_OUTREACH_SHA256,
  sendModeCopy,
  type SendMode,
} from "./message";

export function ApprovalPanel({
  mode = DEFAULT_SEND_MODE,
  onModeChange,
}: {
  mode?: SendMode;
  onModeChange?: (mode: SendMode) => void;
}) {
  return (
    <section className="ds-approval" aria-label="Approval">
      <h2>Exact message</h2>
      <p className="ds-note">The ledger binds the SHA-256 of this text. An edit voids the approval.</p>
      <Segmented
        label="Sending mode"
        name="aria-send-mode"
        value={mode}
        onChange={(next) => onModeChange?.(next)}
        options={[
          { value: "human", label: "Manual" },
          { value: "auto_qc", label: "Full automatic" },
        ]}
      />
      <p className="ds-live">{sendModeCopy(mode)}</p>
      <pre className="ds-message" data-testid="exact-message">
        {EXACT_OUTREACH_MESSAGE}
      </pre>
      <code className="ds-hash">SHA-256 {EXACT_OUTREACH_SHA256}</code>
    </section>
  );
}
