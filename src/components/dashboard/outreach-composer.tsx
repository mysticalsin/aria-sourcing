"use client";

import { Button, Card, Eyebrow } from "@/components/ui";

/** Exact text a person approves. The digest is the hash of that text. */
export function OutreachComposer({
  toName,
  channelLabel,
  subject,
  exactText,
  digest,
  dirty,
  onApprove,
  onMarkSent,
}: {
  toName: string;
  channelLabel: string;
  subject: string | null;
  exactText: string | null;
  digest: string | null;
  dirty: boolean;
  onApprove?: () => void;
  onMarkSent?: () => void;
}) {
  const manual = channelLabel.toLowerCase().includes("inmail");
  return (
    <Card className="p-5" aria-label="Exact text approval">
      <Eyebrow>Exact text</Eyebrow>
      <h3 className="mt-2 text-lg font-bold tracking-tight text-ink">
        {toName} · {channelLabel}
      </h3>
      {subject && <p className="mt-2 text-sm font-semibold text-ink">{subject}</p>}
      {exactText == null ? (
        <p className="mt-3 text-sm text-muted">Exact text unavailable</p>
      ) : (
        <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-canvas p-4 text-sm leading-relaxed text-ink">{exactText}</pre>
      )}
      <p className="mt-3 text-xs text-muted">
        SHA-256 <code className="break-all font-mono text-ink">{digest ?? "—"}</code>
      </p>
      {dirty && (
        <p className="mt-2 text-sm font-semibold text-tangerine">Any edit changes the hash and voids the approval.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => onApprove?.()} disabled={!onApprove}>
          Approve exact text
        </Button>
        {manual && (
          <Button type="button" size="sm" variant="outline" onClick={() => onMarkSent?.()} disabled={!onMarkSent}>
            Mark sent
          </Button>
        )}
      </div>
    </Card>
  );
}
