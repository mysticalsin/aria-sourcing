/**
 * Client helpers for LinkedIn Browser Computer VMs.
 * ensure alone only registers an in-process row — start boots Chromium on Fly.
 *
 * resolveDurableComputerId always probes reclaim_healthy_orphan first so Deploy /
 * Add / Attach / Login reuse a probed-healthy host orphan (or a healthy stored id)
 * instead of minting a blank profile that forces LinkedIn login and burns host slots.
 */

export type BootBrowserComputerResult = {
  ok: boolean;
  booted: boolean;
  error?: string;
  status?: string;
};

/**
 * Prefer a probed-healthy durable profile before minting.
 * Passes existing computerId into reclaim so a healthy stored binding is kept;
 * an unhealthy / blank mint yields to a healthy host orphan when one exists.
 */
export async function resolveDurableComputerId(opts: {
  seatId: string;
  existingComputerId?: string | null;
}): Promise<string> {
  const seatId = opts.seatId.trim();
  const existing = (opts.existingComputerId ?? "").trim();
  if (!seatId) {
    return existing || `comp_${globalThis.crypto.randomUUID()}`;
  }

  try {
    const res = await fetch("/api/fleet/computers", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reclaim_healthy_orphan",
        seatId,
        ...(existing ? { computerId: existing } : {}),
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      error?: string;
      sessionHealthy?: boolean | null;
      computer?: { computerId?: string; sessionHealthy?: boolean | null };
    } | null;
    if (!res.ok) {
      const err = (json?.error ?? "").toLowerCase();
      // Foreign Hermes id — mint rather than reuse another seat's VM.
      if (
        existing &&
        /ownership-mismatch|orphan-claim-blocked|no-healthy-orphan/.test(err)
      ) {
        return `comp_${globalThis.crypto.randomUUID()}`;
      }
    } else {
      const healthy =
        json?.sessionHealthy === true || json?.computer?.sessionHealthy === true;
      const nextId = json?.computer?.computerId?.trim();
      // Never invent healthy — only accept ids the supervisor probed true.
      if (healthy && nextId) return nextId;
    }
  } catch {
    /* keep existing or mint below */
  }

  if (existing) return existing;
  return `comp_${globalThis.crypto.randomUUID()}`;
}

export async function bootBrowserComputer(opts: {
  seatId: string;
  computerId: string;
  campaignId?: string;
}): Promise<BootBrowserComputerResult> {
  const computerId = opts.computerId.trim();
  const seatId = opts.seatId.trim();
  if (!computerId || !seatId) {
    return { ok: false, booted: false, error: "seatId and computerId required" };
  }

  await fetch("/api/fleet/computers", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "ensure",
      computerId,
      seatId,
      campaignId: opts.campaignId,
    }),
  }).catch(() => null);

  const startRes = await fetch("/api/fleet/computers", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "start",
      computerId,
      campaignId: opts.campaignId,
    }),
  }).catch(() => null);

  if (!startRes) {
    return { ok: false, booted: false, error: "Computer host unreachable" };
  }

  const body = (await startRes.json().catch(() => ({}))) as {
    error?: string;
    computer?: { status?: string; lastError?: string | null };
  };
  const err = body.error || body.computer?.lastError || "";
  if (!startRes.ok || body.computer?.status === "error" || /max computers/i.test(err)) {
    return {
      ok: false,
      booted: false,
      error: err || `HTTP ${startRes.status}`,
      status: body.computer?.status,
    };
  }
  return { ok: true, booted: true, status: body.computer?.status };
}
