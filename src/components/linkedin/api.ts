/* Tiny JSON client for the /api/linkedin/* routes. */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; disabled: boolean };

export async function linkedInApi<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok !== true) {
      return {
        ok: false,
        status: res.status,
        error: String(json.detail ?? json.error ?? `HTTP ${res.status}`),
        disabled: json.error === "linkedin_bridge_disabled",
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "ARIA is not reachable.", disabled: false };
  }
}

export const postJson = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/** "jane-doe" from a LinkedIn profile URL, for the new-message preview only. */
export function profileHandle(input: string): string | null {
  const match = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(input.trim());
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
