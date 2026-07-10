"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, useToast } from "@/components/ui";
import { Check, MessageCircle, RefreshCw, X } from "lucide-react";

type WhatsAppReviewDraft = {
  id: string;
  candidate_id: string;
  to_address: string;
  body: string;
  created_at: string;
};

type ReviewListResponse = {
  ok: boolean;
  drafts?: WhatsAppReviewDraft[];
  error?: string;
};

type ReviewAction = { action: "approve" } | { action: "reject" };

type ReviewActionResponse = {
  ok: boolean;
  status?: "queued" | "rejected";
  error?: string;
};

/**
 * Server-backed review inbox for candidate replies that arrived through the
 * signed WhatsApp webhook. The stored body is intentionally read-only: the
 * approval hash must bind to exactly the text the reviewer sees.
 */
export function WhatsAppReviewQueue() {
  const { toast } = useToast();
  const [drafts, setDrafts] = React.useState<WhatsAppReviewDraft[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actingOn, setActingOn] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/outreach/whatsapp-review", {
        headers: { accept: "application/json" },
        signal,
      });
      const result = (await response.json().catch(() => ({ ok: false }))) as ReviewListResponse;
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Could not load WhatsApp review drafts.");
      }
      setDrafts(result.drafts ?? []);
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof Error ? error.message : "Could not load WhatsApp review drafts.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function postDecision(messageId: string, decision: ReviewAction) {
    if (actingOn) return;
    setActingOn(messageId);
    try {
      const response = await fetch("/api/outreach/whatsapp-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, ...decision }),
      });
      const result = (await response.json().catch(() => ({ ok: false }))) as ReviewActionResponse;
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Could not record the WhatsApp review decision.");
      }
      setDrafts((current) => current.filter((draft) => draft.id !== messageId));
      toast({
        title: result.status === "queued" ? "WhatsApp reply approved" : "WhatsApp reply rejected",
        description: result.status === "queued"
          ? "Queued for the guarded outbound dispatcher."
          : "This reply remains blocked and will not be sent.",
        variant: result.status === "queued" ? "success" : "warning",
      });
    } catch (error) {
      toast({
        title: "Could not record the WhatsApp review",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setActingOn(null);
    }
  }

  if (!loading && !loadError && drafts.length === 0) return null;

  return (
    <section aria-labelledby="whatsapp-review-heading">
      <Card className="border-electric/20">
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-electric/10 text-electric" aria-hidden>
                <MessageCircle className="h-4 w-4" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="whatsapp-review-heading" className="text-base font-bold text-ink">
                    WhatsApp replies awaiting review
                  </h2>
                  {drafts.length > 0 && <Badge tone="electric" size="sm" dot>{drafts.length} waiting</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted">
                  Approve the exact stored reply or reject it. Nothing sends until approval is recorded.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              loading={loading}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </div>

          {loadError && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3">
              <p className="text-sm font-medium text-danger">{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          )}

          {loading && drafts.length === 0 && (
            <p className="text-sm text-muted" role="status">Loading WhatsApp review drafts…</p>
          )}

          {drafts.length > 0 && (
            <ul className="space-y-3" aria-label="WhatsApp replies awaiting review">
              {drafts.map((draft) => {
                const deciding = actingOn === draft.id;
                return (
                  <li key={draft.id} className="rounded-2xl border border-line bg-surface p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">To {draft.to_address}</span>
                      <Badge tone="neutral" size="sm">Candidate reply</Badge>
                    </div>
                    <label className="sr-only" htmlFor={`whatsapp-review-${draft.id}`}>Stored WhatsApp reply</label>
                    <textarea
                      id={`whatsapp-review-${draft.id}`}
                      value={draft.body}
                      readOnly
                      rows={Math.min(8, Math.max(3, draft.body.split("\n").length + 1))}
                      className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm leading-relaxed text-ink outline-none focus-visible:ring-2 focus-visible:ring-electric/50"
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        leftIcon={<Check className="h-3.5 w-3.5" aria-hidden />}
                        loading={deciding}
                        disabled={Boolean(actingOn)}
                        onClick={() => void postDecision(draft.id, { action: "approve" })}
                      >
                        Approve and queue
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        leftIcon={<X className="h-3.5 w-3.5" aria-hidden />}
                        disabled={Boolean(actingOn)}
                        onClick={() => void postDecision(draft.id, { action: "reject" })}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
