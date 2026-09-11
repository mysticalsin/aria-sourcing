/**
 * Client helper: ensure + start a LinkedIn Browser Computer VM.
 * ensure alone only registers an in-process row — start boots Chromium on Fly.
 */

export type BootBrowserComputerResult = {
  ok: boolean;
  booted: boolean;
  error?: string;
  status?: string;
};

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
