import { normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";

export type EnforcedSuppressionType = "email" | "domain" | "phone";

export function suppressionDeleteConfirmed(row: unknown): row is { id: string } {
  return Boolean(row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string");
}

export function normalizeSuppressionValue(type: EnforcedSuppressionType, rawValue: string): string | null {
  const raw = rawValue.trim();
  if (type === "phone") return normalizeWhatsAppAddress(raw);
  const value = raw.toLowerCase();
  if (type === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
  }
  const domain = value.replace(/^@/, "");
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    ? domain
    : null;
}

export async function persistManualSuppression(
  input: { type: EnforcedSuppressionType; value: string; reason: string; expiresAt?: string | null },
  method: "POST" | "DELETE",
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const value = normalizeSuppressionValue(input.type, input.value);
  if (!value) return { ok: false, error: "Enter a valid suppression value." };
  try {
    const response = await fetcher("/api/compliance/suppress", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, value }),
    });
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      synced?: boolean;
      value?: string;
      error?: string;
      detail?: string;
    } | null;
    if (!response.ok || !result?.ok || result.synced !== true || result.value !== value) {
      return { ok: false, error: result?.error ?? result?.detail ?? "The server did not confirm the enforcement update." };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error updating suppression." };
  }
}
