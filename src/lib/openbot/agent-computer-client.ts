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

async function computerFetch(
  cfg: OpenBotAgentComputerConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 60_000, ...rest } = init;
  return fetch(`${root(cfg.baseUrl)}${path}`, {
    ...rest,
    headers: {
      ...headers(cfg),
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
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
    throw new Error(data.error || `OpenBot navigate ${res.status}`);
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
    throw new Error(data.error || `OpenBot snapshot ${res.status}`);
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
    throw new Error(data.error || `OpenBot click ${res.status}`);
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
    throw new Error(data.error || `OpenBot type ${res.status}`);
  }
}

export async function openBotTakeControl(cfg: OpenBotAgentComputerConfig): Promise<void> {
  const res = await computerFetch(cfg, "/control/take", { method: "POST", body: "{}" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `OpenBot take control ${res.status}`);
  }
}

export async function openBotReleaseControl(cfg: OpenBotAgentComputerConfig): Promise<void> {
  const res = await computerFetch(cfg, "/control/release", { method: "POST", body: "{}" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `OpenBot release control ${res.status}`);
  }
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
    throw new Error(data.error || `OpenBot read ${res.status}`);
  }
  return { url: data.url ?? "", title: data.title ?? "", text: data.text ?? "" };
}
