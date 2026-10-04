/**
 * HTTP client for CopilotKit OpenBot agent-computer (Playwright Chromium).
 * Auth: x-openbot-computer-token or Authorization Bearer (COMPUTER_TOKEN).
 * Bot: x-openbot-bot-id.
 */

import { toOpenBotBotId } from "@/lib/openbot/bot-id";

export type OpenBotAgentComputerConfig = {
  baseUrl: string;
  computerToken: string;
  botId: string;
};

export type OpenBotSnapshotElement = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
};

export type OpenBotSnapshot = {
  /** OpenBot wire field is snapshotId; we normalize to snapshotId. */
  snapshotId: number;
  url: string;
  title: string;
  elements: OpenBotSnapshotElement[];
  truncated?: boolean;
};

function root(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function headers(cfg: OpenBotAgentComputerConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.computerToken}`,
    "x-openbot-computer-token": cfg.computerToken,
    "x-openbot-bot-id": toOpenBotBotId(cfg.botId),
  };
}

/** Always keep `OpenBot <op> <status>` so deliver preActNotSent can soft-defer. */
function openBotHttpError(op: string, status: number, bodyError?: string): Error {
  const body = (bodyError ?? "").trim();
  return new Error(body ? `${body} (OpenBot ${op} ${status})` : `OpenBot ${op} ${status}`);
}

async function computerFetch(
  cfg: OpenBotAgentComputerConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 60_000, ...rest } = init;
  const op = path.replace(/^\//, "") || "request";
  try {
    return await fetch(`${root(cfg.baseUrl)}${path}`, {
      ...rest,
      headers: {
        ...headers(cfg),
        ...(rest.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "";
    // Label abort/timeout with op so deliver can soft-defer pre-act (navigate/snapshot)
    // without treating post-Send click/type abort as not-sent (ambiguous).
    if (/abort|timeout/i.test(msg) || /AbortError|TimeoutError/i.test(name)) {
      throw new Error(`OpenBot ${op} aborted/timeout: ${msg || name || "aborted"}`);
    }
    throw err;
  }
}

export async function openBotNavigate(
  cfg: OpenBotAgentComputerConfig,
  url: string,
): Promise<{ url: string; title: string; text?: string; error?: string }> {
  const res = await computerFetch(cfg, "/navigate", {
    method: "POST",
    body: JSON.stringify({ url }),
    timeoutMs: 60_000,
  });
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    title?: string;
    text?: string;
    error?: string;
  };
  if (!res.ok) {
    throw openBotHttpError("navigate", res.status, data.error);
  }
  return { url: data.url ?? url, title: data.title ?? "", text: data.text };
}

export async function openBotSnapshot(cfg: OpenBotAgentComputerConfig): Promise<OpenBotSnapshot> {
  const res = await computerFetch(cfg, "/snapshot", {
    method: "POST",
    body: "{}",
    timeoutMs: 30_000,
  });
  const data = (await res.json().catch(() => ({}))) as {
    snapshotId?: number;
    url?: string;
    title?: string;
    elements?: OpenBotSnapshotElement[];
    truncated?: boolean;
    error?: string;
  };
  if (!res.ok) {
    throw openBotHttpError("snapshot", res.status, data.error);
  }
  return {
    snapshotId: typeof data.snapshotId === "number" ? data.snapshotId : 0,
    url: data.url ?? "",
    title: data.title ?? "",
    elements: Array.isArray(data.elements) ? data.elements : [],
    truncated: data.truncated,
  };
}

export async function openBotClick(
  cfg: OpenBotAgentComputerConfig,
  ref: string,
  snapshotId: number,
): Promise<void> {
  const res = await computerFetch(cfg, "/click", {
    method: "POST",
    body: JSON.stringify({ ref, snapshotId }),
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw openBotHttpError("click", res.status, data.error);
  }
}

export async function openBotType(
  cfg: OpenBotAgentComputerConfig,
  ref: string,
  snapshotId: number,
  text: string,
  submit = false,
): Promise<void> {
  const res = await computerFetch(cfg, "/type", {
    method: "POST",
    body: JSON.stringify({ ref, snapshotId, text, submit }),
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw openBotHttpError("type", res.status, data.error);
  }
}

export async function openBotTakeControl(cfg: OpenBotAgentComputerConfig): Promise<void> {
  const res = await computerFetch(cfg, "/control/take", { method: "POST", body: "{}" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw openBotHttpError("take control", res.status, data.error);
  }
}

export async function openBotReleaseControl(cfg: OpenBotAgentComputerConfig): Promise<void> {
  const res = await computerFetch(cfg, "/control/release", { method: "POST", body: "{}" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw openBotHttpError("release control", res.status, data.error);
  }
}

/** LinkedIn session probe — POST /session-probe on the Chromium computer (classifySessionProbe). */
export type OpenBotSessionProbeResult = {
  healthy: boolean;
  detail: string;
  url?: string;
};

export async function openBotSessionProbe(
  cfg: OpenBotAgentComputerConfig,
  url?: string,
): Promise<OpenBotSessionProbeResult> {
  const res = await computerFetch(cfg, "/session-probe", {
    method: "POST",
    body: JSON.stringify(url ? { url } : {}),
    timeoutMs: 60_000,
  });
  const data = (await res.json().catch(() => ({}))) as {
    healthy?: boolean;
    detail?: string;
    url?: string;
    error?: string;
  };
  if (!res.ok) {
    throw openBotHttpError("session-probe", res.status, data.error);
  }
  return {
    healthy: data.healthy === true,
    detail:
      typeof data.detail === "string" && data.detail.trim()
        ? data.detail
        : data.healthy === true
          ? "LinkedIn session appears logged in"
          : "LinkedIn session not confirmed",
    url: typeof data.url === "string" ? data.url : undefined,
  };
}

export async function openBotReadPage(
  cfg: OpenBotAgentComputerConfig,
): Promise<{ url: string; title: string; text: string }> {
  const res = await computerFetch(cfg, "/read", { method: "GET", timeoutMs: 30_000 });
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    title?: string;
    text?: string;
    error?: string;
  };
  if (!res.ok) {
    throw openBotHttpError("read", res.status, data.error);
  }
  return { url: data.url ?? "", title: data.title ?? "", text: data.text ?? "" };
}
