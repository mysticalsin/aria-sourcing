"use client";

import * as React from "react";
import { BookOpen, RefreshCw, Sparkles } from "lucide-react";
import { Button, Badge } from "@/components/ui";

type WikiNote = {
  id: string;
  kind: string;
  title: string;
  body: string;
};

type WikiPayload = {
  notes?: WikiNote[];
  edges?: Array<{ fromLabel: string; toLabel: string; relation: string; kind: string }>;
  draftContext?: string;
  suggestedGithubQuery?: string | null;
  grantsContactClaim?: boolean;
  brainStore?: string;
  wikiPath?: string;
};

/**
 * Campaign LLM wiki brain — durable markdown recall, never a contact lock.
 */
export function CampaignWikiPanel({ campaignId }: { campaignId: string }) {
  const [data, setData] = React.useState<WikiPayload | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (seed = false) => {
      setBusy(true);
      setError(null);
      try {
        const url = seed
          ? `/api/knowledge/campaign?campaignId=${encodeURIComponent(campaignId)}&seed=java`
          : `/api/knowledge/campaign?campaignId=${encodeURIComponent(campaignId)}`;
        const res = await fetch(url, { credentials: "same-origin" });
        const body = (await res.json().catch(() => ({}))) as WikiPayload & { error?: string };
        if (!res.ok) {
          setError(body.error ?? res.statusText);
          return;
        }
        setData(body);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load wiki");
      } finally {
        setBusy(false);
      }
    },
    [campaignId],
  );

  React.useEffect(() => {
    void load(true);
  }, [load]);

  return (
    <section className="rounded-2xl border border-line bg-surface/80 p-5" aria-labelledby="wiki-brain-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Agent brain</p>
          <h2 id="wiki-brain-heading" className="mt-0.5 flex items-center gap-2 text-base font-semibold text-ink">
            <BookOpen className="h-4 w-4 text-electric" aria-hidden />
            LLM wiki
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Durable markdown playbooks for this campaign. Recall only — contact permission stays on
            the Postgres lease.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge size="sm" tone="electric">
            {data?.brainStore ?? "llm-wiki"}
          </Badge>
          <Badge size="sm" tone={data?.grantsContactClaim ? "danger" : "neutral"}>
            {data?.grantsContactClaim ? "grants claim (bug)" : "no contact grant"}
          </Badge>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void load(false)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Refresh
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void load(true)}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Seed Java wiki
          </Button>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      {data?.suggestedGithubQuery ? (
        <p className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 font-mono text-xs text-ink">
          Suggested search: {data.suggestedGithubQuery}
        </p>
      ) : null}

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {(data?.notes ?? []).map((n) => (
          <li key={n.id} className="rounded-xl border border-line/70 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{n.kind}</p>
            <p className="text-sm font-semibold text-ink">{n.title}</p>
            <p className="mt-1 line-clamp-4 text-xs text-muted">{n.body}</p>
          </li>
        ))}
      </ul>

      {data?.wikiPath ? (
        <p className="mt-3 font-mono text-[10px] text-muted">Path: {data.wikiPath}</p>
      ) : null}
    </section>
  );
}
