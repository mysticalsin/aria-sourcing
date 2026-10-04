/**
 * Client helpers for LinkedIn Browser Computer VMs.
 * ensure alone only registers an in-process row — start boots Chromium on Fly.
 *
 * resolveDurableComputerId always probes reclaim_healthy_orphan first so Deploy /
 * Add / Attach / Login reuse a probed-healthy host orphan (or a healthy stored id)
 * instead of minting a blank profile that forces LinkedIn login and burns host slots.
 *
 * When a new id is required, mint via POST ensure (server makeId) — never client
 * crypto.randomUUID twins that can race and burn host slots.
 *
 * Pass campaignId only when the seat is already campaign-attached — otherwise
 * refuseUnattached will block ensure/reclaim for N-agent isolation. Pre-attach
 * flows (campaign page attach-before-assign) must omit it.
 */

export type BootBrowserComputerResult = {
  ok: boolean;
  booted: boolean;
  error?: string;
  status?: string;
};

/** Server-owned id mint — one ensure row per seat, no client UUID race. */
async function mintComputerIdViaEnsure(
  seatId: string,
  campaignId?: string,
): Promise<string> {
  const res = await fetch("/api/fleet/computers", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "ensure",
      seatId,
      ...(campaignId ? { campaignId } : {}),
    }),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: string;
    computer?: { computerId?: string };
  } | null;
  const id = (json?.computer?.computerId ?? "").trim();
  if (!res.ok || !id) {
    throw new Error(json?.error || `ensure mint HTTP ${res.status}`);
  }
  return id;
}

/**
 * Prefer a probed-healthy durable profile before minting.
 * Passes existing computerId into reclaim so a healthy stored binding is kept;
 * an unhealthy / blank mint yields to a healthy host orphan when one exists.
 */
export async function resolveDurableComputerId(opts: {
  seatId: string;
  existingComputerId?: string | null;
  /** Only when seat is already attached — gates refuseUnattached. */
  campaignId?: string | null;
}): Promise<string> {
  const seatId = opts.seatId.trim();
  const existing = (opts.existingComputerId ?? "").trim();
  const campaignId = (opts.campaignId ?? "").trim() || undefined;
  if (!seatId) {
    if (existing) return existing;
    throw new Error("seatId required to mint a Browser Computer");
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
        ...(campaignId ? { campaignId } : {}),
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      error?: string;
      sessionHealthy?: boolean | null;
      computer?: { computerId?: string; sessionHealthy?: boolean | null };
    } | null;
    if (!res.ok) {
      const err = (json?.error ?? "").toLowerCase();
      // Half-applied reclaim — never mint a twin while durable bind may be inconsistent.
      if (/persist failed|computer_id persist failed/.test(err)) {
        if (existing) return existing;
        throw new Error(json?.error ?? "computer_id persist failed");
      }
      // Mid-Take: never mint — keep existing if any; otherwise surface (Login/Deploy must not orphan).
      if (/computer-human-held|human-has-control/.test(err)) {
        if (existing) return existing;
        throw new Error(json?.error ?? "computer-human-held");
      }
      // Foreign id — server mint; never keep another seat's VM.
      if (existing && /ownership-mismatch|orphan-claim-blocked/.test(err)) {
        return mintComputerIdViaEnsure(seatId, campaignId);
      }
      // no-healthy-orphan means the stored id was not seat-bound healthy
      // (orphan twin / foreign / absent). Never keep it — mint a blank desk
      // rather than feed a login-wall twin into ensure→claim.
      if (existing && /no-healthy-orphan/.test(err)) {
        return mintComputerIdViaEnsure(seatId, campaignId);
      }
      if (!existing && /no-healthy-orphan|ownership-mismatch|orphan-claim-blocked/.test(err)) {
        return mintComputerIdViaEnsure(seatId, campaignId);
      }
    } else {
      const healthy =
        json?.sessionHealthy === true || json?.computer?.sessionHealthy === true;
      const nextId = json?.computer?.computerId?.trim();
      // Never invent healthy — only accept ids the supervisor probed true.
      if (healthy && nextId) return nextId;
    }
  } catch (err) {
    // Persist failure with no existing id must surface — do not mint a twin.
    if (err instanceof Error && /persist failed|computer_id persist failed/i.test(err.message)) {
      throw err;
    }
    if (err instanceof Error && /ensure mint/i.test(err.message)) {
      throw err;
    }
    /* keep existing or mint below */
  }

  if (existing) return existing;
  return mintComputerIdViaEnsure(seatId, campaignId);
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

  const ensureRes = await fetch("/api/fleet/computers", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "ensure",
      computerId,
      seatId,
      ...(opts.campaignId?.trim() ? { campaignId: opts.campaignId.trim() } : {}),
    }),
  }).catch(() => null);

  if (!ensureRes) {
    return { ok: false, booted: false, error: "Computer host unreachable (ensure)" };
  }
  const ensureBody = (await ensureRes.json().catch(() => ({}))) as {
    error?: string;
    computer?: { computerId?: string; seatId?: string };
  };
  if (!ensureRes.ok) {
    return {
      ok: false,
      booted: false,
      error: ensureBody.error || `ensure HTTP ${ensureRes.status}`,
    };
  }
  const ensuredId = (ensureBody.computer?.computerId ?? "").trim() || computerId;
  const ensuredSeat = (ensureBody.computer?.seatId ?? "").trim();
  // Fail closed — never start a VM ensure bound to a different seat.
  if (ensuredSeat && ensuredSeat !== seatId) {
    return {
      ok: false,
      booted: false,
      error: `computer-ownership-mismatch: ensure bound seat ${ensuredSeat}, not ${seatId}`,
    };
  }

  const startRes = await fetch("/api/fleet/computers", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "start",
      computerId: ensuredId,
      seatId,
      ...(opts.campaignId?.trim() ? { campaignId: opts.campaignId.trim() } : {}),
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
