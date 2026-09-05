/**
 * HTTP client for CopilotKit OpenBot computer supervisor.
 * Verbs: ensure / stop / reset / list. Auth: Bearer SUPERVISOR_TOKEN.
 */

import { toOpenBotBotId } from "@/lib/openbot/bot-id";

export type OpenBotComputerState = {
  botId: string;
  container?: string;
  status: string;
  startedAt?: string;
  port?: number;
  /** Agent-computer base URL when published or on a shared network. */
  url?: string;
};

export type OpenBotSupervisorConfig = {
  baseUrl: string;
  token: string;
};

function root(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

async function supervisorFetch(
  cfg: OpenBotSupervisorConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 60_000, ...rest } = init;
  return fetch(`${root(cfg.baseUrl)}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

type OpenBotEnsureWire = {
  botId?: string;
  container?: string;
  status?: string;
  startedAt?: string;
  port?: number;
  url?: string;
};

function mapState(botId: string, data: OpenBotEnsureWire): OpenBotComputerState {
  return {
    botId: data.botId || botId,
    container: data.container,
    status: data.status ?? "unknown",
    startedAt: data.startedAt,
    port: data.port,
    url: data.url,
  };
}

export async function openBotEnsureComputer(
  cfg: OpenBotSupervisorConfig,
  computerOrSeatId: string,
): Promise<OpenBotComputerState> {
  const botId = toOpenBotBotId(computerOrSeatId);
  const res = await supervisorFetch(cfg, `/computers/${encodeURIComponent(botId)}/ensure`, {
    method: "POST",
    body: "{}",
    timeoutMs: 120_000,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenBot ensure ${res.status}: ${err.slice(0, 240) || res.statusText}`);
  }
  const data = (await res.json()) as OpenBotEnsureWire;
  return mapState(botId, data);
}

export async function openBotStopComputer(
  cfg: OpenBotSupervisorConfig,
  computerOrSeatId: string,
): Promise<{ stopped: boolean }> {
  const botId = toOpenBotBotId(computerOrSeatId);
  const res = await supervisorFetch(cfg, `/computers/${encodeURIComponent(botId)}/stop`, {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenBot stop ${res.status}: ${err.slice(0, 240) || res.statusText}`);
  }
  const data = (await res.json().catch(() => ({}))) as { stopped?: boolean };
  return { stopped: data.stopped !== false };
}

export async function openBotResetComputer(
  cfg: OpenBotSupervisorConfig,
  computerOrSeatId: string,
): Promise<{ reset: boolean }> {
  const botId = toOpenBotBotId(computerOrSeatId);
  const res = await supervisorFetch(cfg, `/computers/${encodeURIComponent(botId)}/reset`, {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenBot reset ${res.status}: ${err.slice(0, 240) || res.statusText}`);
  }
  const data = (await res.json().catch(() => ({}))) as { reset?: boolean };
  return { reset: Boolean(data.reset) };
}

export async function openBotListComputers(
  cfg: OpenBotSupervisorConfig,
): Promise<{ computers: OpenBotComputerState[] }> {
  const res = await supervisorFetch(cfg, `/computers`, { method: "GET" });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenBot list ${res.status}: ${err.slice(0, 240) || res.statusText}`);
  }
  const data = (await res.json()) as {
    computers?: OpenBotEnsureWire[];
  };
  const computers = (data.computers ?? []).map((c) =>
    mapState(c.botId || "unknown", c),
  );
  return { computers };
}
