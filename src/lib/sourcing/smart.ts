/**
 * SMART (S-M-A-R-T) — internal resume DB + OCR'd resume text matcher.
 * SERVER ONLY. Contract: smart-contract.ts
 */

import "server-only";

import type { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { sourcingFetch, type ProviderClearance } from "@/lib/sourcing/provider-transport";
import {
  mockMatchResumes,
  selectBestSmartMatches,
  toSmartResumeHit,
  SMART_DEFAULT_RANK_WINDOW,
  SMART_MAX_RANK_WINDOW,
  type SmartMatchRequest,
  type SmartResumeHit,
  type SmartWritebackReceipt,
  type SmartWritebackRequest,
} from "@/lib/sourcing/smart-contract";

export type {
  SmartMatchRequest,
  SmartResumeHit,
  SmartWritebackReceipt,
  SmartWritebackRequest,
} from "@/lib/sourcing/smart-contract";

export {
  mockMatchResumes,
  mockSmartCorpus,
  selectBestSmartMatches,
  toSmartResumeHit,
  SMART_DEFAULT_RANK_WINDOW,
  SMART_MAX_RANK_WINDOW,
} from "@/lib/sourcing/smart-contract";

export type SmartResult<T> =
  | { ok: true; status: number; data: T; mode: "live" | "mock" }
  | { ok: false; status: number; title: string; detail: string; mode: "live" | "mock" };

function smartBaseUrl(): string | null {
  const raw = process.env.SMART_API_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function smartForceMock(): boolean {
  return process.env.SMART_FORCE_MOCK === "true";
}

export function smartLiveConfigured(apiKey?: string | null): boolean {
  if (smartForceMock()) return false;
  return Boolean(smartBaseUrl() && apiKey?.trim());
}

export function smartRuntimeMode(apiKey?: string | null): "live" | "mock" | "unavailable" {
  if (smartForceMock()) return "mock";
  if (smartLiveConfigured(apiKey)) return "live";
  return "unavailable";
}

async function smartRequest<T>(
  clearance: ProviderClearance,
  path: string,
  apiKey: string,
  opts: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<SmartResult<T>> {
  const base = smartBaseUrl();
  if (!base) {
    return {
      ok: false,
      status: 0,
      title: "SMART not configured",
      detail: "SMART_API_BASE_URL is missing.",
      mode: "live",
    };
  }
  try {
    const res = await sourcingFetch(clearance, `${base}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const title = typeof json.title === "string" ? json.title : `SMART API error (${res.status})`;
      const detail =
        typeof json.detail === "string"
          ? json.detail
          : typeof json.message === "string"
            ? json.message
            : "";
      return { ok: false, status: res.status, title, detail, mode: "live" };
    }
    return { ok: true, status: res.status, data: json as T, mode: "live" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMART unreachable.";
    return { ok: false, status: 0, title: "Network error", detail: message, mode: "live" };
  }
}

export async function searchSmartResumes(
  clearance: ProviderClearance,
  req: SmartMatchRequest,
  apiKey?: string | null,
): Promise<SmartResult<{ results: SmartResumeHit[]; total: number; hasMore: boolean }>> {
  const limit = Math.min(
    Math.max(Math.trunc(req.limit) || SMART_DEFAULT_RANK_WINDOW, 1),
    SMART_MAX_RANK_WINDOW,
  );
  const normalized: SmartMatchRequest = {
    ...req,
    title: req.title.trim().slice(0, 200),
    requiredSkills: (req.requiredSkills ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 40),
    niceToHaveSkills: (req.niceToHaveSkills ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40),
    regions: (req.regions ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
    keywords: req.keywords?.trim().slice(0, 500),
    limit,
    offset: Math.max(0, Math.trunc(req.offset ?? 0)),
  };

  if (smartForceMock()) {
    const results = mockMatchResumes(normalized);
    return {
      ok: true,
      status: 200,
      mode: "mock",
      data: { results, total: results.length, hasMore: false },
    };
  }

  const key = apiKey?.trim();
  if (!key || !smartBaseUrl()) {
    return {
      ok: false,
      status: 503,
      title: "SMART not configured",
      detail:
        "SMART live sourcing requires SMART_API_BASE_URL and a stored SMART API key (or SMART_API_KEY). No mock fallback without SMART_FORCE_MOCK=true.",
      mode: "live",
    };
  }

  const body = {
    title: normalized.title,
    required_skills: normalized.requiredSkills,
    nice_to_have_skills: normalized.niceToHaveSkills ?? [],
    regions: normalized.regions ?? [],
    keywords: normalized.keywords ?? "",
    limit: normalized.limit,
    offset: normalized.offset ?? 0,
  };

  const res = await smartRequest<{
    results?: unknown[];
    data?: unknown[];
    total?: number;
    has_more?: boolean;
    hasMore?: boolean;
  }>(clearance, "/v1/resumes/match", key, { method: "POST", body, timeoutMs: 25_000 });

  if (!res.ok) return res;

  const rawList = Array.isArray(res.data.results)
    ? res.data.results
    : Array.isArray(res.data.data)
      ? res.data.data
      : [];
  const results = rawList
    .map(toSmartResumeHit)
    .filter((h): h is SmartResumeHit => Boolean(h));
  const ranked = selectBestSmartMatches(results, normalized.limit);
  return {
    ok: true,
    status: res.status,
    mode: "live",
    data: {
      results: ranked,
      total: typeof res.data.total === "number" ? res.data.total : ranked.length,
      hasMore: Boolean(res.data.has_more ?? res.data.hasMore),
    },
  };
}

export async function writebackSmartCandidate(
  clearance: ProviderClearance,
  payload: SmartWritebackRequest,
  apiKey?: string | null,
): Promise<SmartResult<SmartWritebackReceipt>> {
  const smartResumeId = payload.smartResumeId.trim();
  if (!smartResumeId) {
    return {
      ok: false,
      status: 400,
      title: "Invalid writeback",
      detail: "smartResumeId is required.",
      mode: smartForceMock() ? "mock" : "live",
    };
  }

  if (smartForceMock()) {
    return {
      ok: true,
      status: 200,
      mode: "mock",
      data: {
        receiptId: `mock_wb_${smartResumeId}_${payload.status}`,
        smartResumeId,
        status: payload.status,
      },
    };
  }

  const key = apiKey?.trim();
  if (!key || !smartBaseUrl()) {
    return {
      ok: false,
      status: 503,
      title: "SMART not configured",
      detail: "SMART writeback requires SMART_API_BASE_URL and a SMART API key.",
      mode: "live",
    };
  }

  const res = await smartRequest<{ receipt_id?: string; receiptId?: string }>(
    clearance,
    `/v1/resumes/${encodeURIComponent(smartResumeId)}/aria-refs`,
    key,
    {
      method: "POST",
      body: {
        aria_candidate_id: payload.ariaCandidateId,
        campaign_id: payload.campaignId,
        campaign_title: payload.campaignTitle ?? "",
        status: payload.status,
        match_score: payload.matchScore ?? null,
        notes: payload.notes ?? "",
      },
      timeoutMs: 15_000,
    },
  );
  if (!res.ok) return res;
  return {
    ok: true,
    status: res.status,
    mode: "live",
    data: {
      receiptId: res.data.receiptId || res.data.receipt_id || `wb_${smartResumeId}`,
      smartResumeId,
      status: payload.status,
    },
  };
}

export async function testSmartConnection(
  clearance: ProviderClearance,
  apiKey: string,
): Promise<SmartResult<{ ok: true }>> {
  if (smartForceMock()) {
    return { ok: true, status: 200, mode: "mock", data: { ok: true } };
  }
  if (!smartBaseUrl()) {
    return {
      ok: false,
      status: 503,
      title: "SMART not configured",
      detail: "SMART_API_BASE_URL is missing.",
      mode: "live",
    };
  }
  return smartRequest(clearance, "/v1/health", apiKey, { timeoutMs: 8_000 });
}

export function envSmartApiKey(): string | null {
  const key = process.env.SMART_API_KEY?.trim();
  return key || null;
}

export async function resolveStoredSmartKey(
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
): Promise<string | null> {
  const svc = getServiceSupabase();
  if (!svc) return envSmartApiKey();
  const { data: wid } = await session.rpc("current_workspace_id");
  if (!wid) return envSmartApiKey();
  const { data: row } = await svc
    .from("api_keys")
    .select("secret")
    .eq("workspace_id", wid)
    .eq("provider", "SMART")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.secret || typeof row.secret !== "string") return envSmartApiKey();
  return decryptSecret(row.secret);
}

export async function resolveStoredSmartKeyForWorkspace(workspaceId: string): Promise<string | null> {
  const svc = getServiceSupabase();
  if (!svc) return envSmartApiKey();
  const { data: row } = await svc
    .from("api_keys")
    .select("secret")
    .eq("workspace_id", workspaceId)
    .eq("provider", "SMART")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.secret || typeof row.secret !== "string") return envSmartApiKey();
  return decryptSecret(row.secret);
}
