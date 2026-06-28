import type { SystemSettings } from "@/lib/types";

/* ============================================================================
   Aria runtime client — talks to the server-side catch-all proxy at
   /api/hermes/<path>. The proxy resolves URL + bearer token server-side.
   ========================================================================== */

export interface HermesRuntimeStatus {
  version?: string;
  status?: string;
  uptime?: number;
  [key: string]: unknown;
}

export interface HermesProxyResult<T = unknown> {
  ok: boolean;
  data?: T;
  reason?: string;
}

function queryFor(path: string, keyId?: string): string {
  const params = new URLSearchParams();
  params.set("upstreamPath", path);
  if (keyId) params.set("hermesApiKeyId", keyId);
  return `?${params.toString()}`;
}

export function hermesRuntimeAvailable(settings: SystemSettings): boolean {
  return !!(settings.hermesLiveMode && settings.hermesApiUrl);
}

export async function getHermesStatus(
  settings: SystemSettings,
): Promise<HermesProxyResult<HermesRuntimeStatus>> {
  return hermesGet("api/status", settings.hermesApiKeyId ?? undefined);
}

export async function getHermesSystemStats(
  settings: SystemSettings,
): Promise<HermesProxyResult<Record<string, unknown>>> {
  return hermesGet("api/system/stats", settings.hermesApiKeyId ?? undefined);
}

export async function getHermesSessions(
  settings: SystemSettings,
): Promise<HermesProxyResult<unknown[]>> {
  return hermesGet("api/sessions", settings.hermesApiKeyId ?? undefined);
}

export async function getHermesMemory(
  settings: SystemSettings,
): Promise<HermesProxyResult<unknown[]>> {
  return hermesGet("api/memory", settings.hermesApiKeyId ?? undefined);
}

export async function getHermesConfig(
  settings: SystemSettings,
): Promise<HermesProxyResult<Record<string, unknown>>> {
  return hermesGet("api/config", settings.hermesApiKeyId ?? undefined);
}

export async function getHermesSkills(
  settings: SystemSettings,
): Promise<HermesProxyResult<unknown[]>> {
  return hermesGet("api/skills", settings.hermesApiKeyId ?? undefined);
}

async function hermesGet<T>(path: string, keyId?: string): Promise<HermesProxyResult<T>> {
  try {
    const res = await fetch(`/api/hermes/proxy${queryFor(path, keyId)}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `Aria returned ${res.status}: ${text}`.trim() };
    }
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: true, data: data ?? undefined };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Network error." };
  }
}

export async function hermesPost<T>(
  path: string,
  body: unknown,
  keyId?: string,
): Promise<HermesProxyResult<T>> {
  try {
    const res = await fetch(`/api/hermes/proxy${queryFor(path, keyId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `Aria returned ${res.status}: ${text}`.trim() };
    }
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: true, data: data ?? undefined };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Network error." };
  }
}
