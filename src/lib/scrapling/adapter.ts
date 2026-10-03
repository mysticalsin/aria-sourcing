/**
 * Scrapling adapter — thin Aria bridge to the vendored Scrapling toolkit
 * (`tools/scrapling`, https://github.com/D4Vinci/Scrapling).
 *
 * Scrapling is a Python stealth-fetch / adaptive-parser library. Aria agents
 * call this adapter from sourcing enrichment; the heavy lifting stays in the
 * Scrapling runtime when configured, otherwise we return a structured
 * "not configured" result so playbooks stay honest.
 */

export type ScraplingFetchInput = {
  url: string;
  /** CSS / adaptive selector hints from the sourcing skill. */
  selectors?: string[];
  /** Keep cookies / TLS fingerprint across research hops. */
  sessionId?: string;
  timeoutMs?: number;
};

export type ScraplingFetchResult =
  | {
      ok: true;
      url: string;
      title?: string;
      text: string;
      extracted: Record<string, string>;
      via: "scrapling" | "stub";
    }
  | {
      ok: false;
      url: string;
      detail: string;
      via: "scrapling" | "stub";
    };

function scraplingEnabled(): boolean {
  return process.env.ARIA_SCRAPLING_ENABLED === "1" || process.env.SCRAPLING_ENABLED === "1";
}

/**
 * Fetch + lightly extract public page text for sourcing research.
 * Production path shells to the Scrapling sidecar when enabled; otherwise
 * returns a clear stub so Agent Skills can still reference the playbook.
 */
export async function scraplingFetch(input: ScraplingFetchInput): Promise<ScraplingFetchResult> {
  const url = input.url.trim();
  if (!url) return { ok: false, url, detail: "url is required", via: "stub" };

  if (!scraplingEnabled()) {
    return {
      ok: false,
      url,
      detail:
        "Scrapling runtime not enabled (set ARIA_SCRAPLING_ENABLED=1). Tooling lives at tools/scrapling.",
      via: "stub",
    };
  }

  // Sidecar contract: POST {url, selectors, sessionId} → {title, text, extracted}
  const base = (process.env.SCRAPLING_URL || process.env.ARIA_SCRAPLING_URL || "").replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      url,
      detail: "ARIA_SCRAPLING_ENABLED but SCRAPLING_URL is unset",
      via: "scrapling",
    };
  }

  try {
    const res = await fetch(`${base}/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        selectors: input.selectors ?? [],
        sessionId: input.sessionId,
        timeoutMs: input.timeoutMs ?? 20_000,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      title?: string;
      text?: string;
      extracted?: Record<string, string>;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        url,
        detail: data.error || `Scrapling HTTP ${res.status}`,
        via: "scrapling",
      };
    }
    return {
      ok: true,
      url,
      title: data.title,
      text: String(data.text ?? "").slice(0, 20_000),
      extracted: data.extracted ?? {},
      via: "scrapling",
    };
  } catch (err) {
    return {
      ok: false,
      url,
      detail: err instanceof Error ? err.message : String(err),
      via: "scrapling",
    };
  }
}
