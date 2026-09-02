import { defaultSendWindow } from "./fleet";
import {
  INTEGRATION_MODES,
  LINKEDIN_SENDER_STATES,
  SEAT_PROVIDERS,
  SEAT_STATUSES,
  type AgentSeat,
  type IntegrationMode,
  type LinkedInSenderState,
  type SeatProvider,
  type SeatStatus,
} from "./types";

// provider_sender_ref is deliberately absent: the vendor's sender id is opaque
// and never reaches the browser. provider_state is enough for the card because
// 0058 guarantees 'connected' implies a sender ref.
export const AGENT_SEAT_SELECT =
  "id, workspace_id, name, operator_email, provider, status, mode, domain_verified, daily_limit, warmup, warmup_start_cap, warmup_step_per_day, warmup_started_at, min_gap_minutes, persona, signature, connected_account, provider_state, created_at";

export interface AgentSeatRow {
  id: string;
  workspace_id?: string;
  name: string;
  operator_email: string;
  provider: string;
  status: string;
  mode: string;
  domain_verified: boolean;
  daily_limit: number;
  warmup: boolean;
  warmup_start_cap: number;
  warmup_step_per_day: number;
  warmup_started_at: string;
  min_gap_minutes: number;
  persona: string;
  signature: string;
  connected_account: string;
  provider_state?: string | null;
  created_at: string;
}

/** Unknown or missing reads as disconnected: the card never shows a state the row did not carry. */
export function linkedInSenderState(value: string | null | undefined): LinkedInSenderState {
  return (LINKEDIN_SENDER_STATES as readonly string[]).includes(value ?? "") ? (value as LinkedInSenderState) : "disconnected";
}

function seatProvider(value: string, fallback?: SeatProvider): SeatProvider {
  return (SEAT_PROVIDERS as readonly string[]).includes(value) ? (value as SeatProvider) : fallback ?? "Microsoft Graph";
}

function seatStatus(value: string, fallback?: SeatStatus): SeatStatus {
  return (SEAT_STATUSES as readonly string[]).includes(value) ? (value as SeatStatus) : fallback ?? "active";
}

function seatMode(value: string, fallback?: IntegrationMode): IntegrationMode {
  return (INTEGRATION_MODES as readonly string[]).includes(value) ? (value as IntegrationMode) : fallback ?? "mock";
}

export function agentSeatRowToSeat(row: AgentSeatRow, existing?: AgentSeat): AgentSeat {
  return {
    id: row.id,
    name: existing?.name ?? row.name,
    operatorEmail: row.operator_email,
    provider: seatProvider(row.provider, existing?.provider),
    status: seatStatus(row.status, existing?.status),
    mode: seatMode(row.mode, existing?.mode),
    domainVerified: row.domain_verified,
    dailyLimit: row.daily_limit,
    warmup: row.warmup,
    warmupStartCap: row.warmup_start_cap,
    warmupStepPerDay: row.warmup_step_per_day,
    warmupStartedAt: row.warmup_started_at,
    minGapMinutes: row.min_gap_minutes,
    sendWindow: existing?.sendWindow ?? defaultSendWindow(),
    sentToday: existing?.sentToday ?? 0,
    lastSendAt: existing?.lastSendAt ?? null,
    health: existing?.health ?? { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: existing?.persona ?? row.persona,
    signature: existing?.signature ?? row.signature,
    color: existing?.color,
    language: existing?.language,
    connectedAccount: row.connected_account,
    providerState: linkedInSenderState(row.provider_state),
    createdAt: row.created_at,
    providerId: existing?.providerId,
    modelId: existing?.modelId,
    toolIds: existing?.toolIds,
  };
}

export function mergeAgentSeatRows(localSeats: AgentSeat[], rows: AgentSeatRow[]): AgentSeat[] {
  const byId = new Map(localSeats.map((seat) => [seat.id, seat]));
  const byEmail = new Map(localSeats.map((seat) => [seat.operatorEmail.toLowerCase(), seat]));
  return rows.map((row) => {
    const existing = byId.get(row.id) ?? byEmail.get(row.operator_email.toLowerCase());
    return agentSeatRowToSeat(row, existing);
  });
}

export async function createFleetSeatOnServer(
  seat: AgentSeat,
): Promise<{ ok: true; seat: AgentSeat; id: string } | { ok: false; error: string }> {
  const res = await fetch("/api/fleet/seats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: seat.name,
      operatorEmail: seat.operatorEmail,
      provider: seat.provider,
      dailyLimit: seat.dailyLimit,
      warmup: seat.warmup,
      warmupStartCap: seat.warmupStartCap,
      warmupStepPerDay: seat.warmupStepPerDay,
      minGapMinutes: seat.minGapMinutes,
      persona: seat.persona,
      signature: seat.signature,
      mode: seat.mode,
    }),
  });
  const out = (await res.json().catch(() => null)) as
    | { ok?: boolean; id?: string; seat?: AgentSeatRow; error?: string }
    | null;
  if (!res.ok || !out?.ok || !out.seat || !out.id) {
    return { ok: false, error: out?.error ?? `Seat create failed (${res.status}).` };
  }
  return { ok: true, id: out.id, seat: agentSeatRowToSeat(out.seat, seat) };
}

export async function patchFleetSeatOnServer(
  id: string,
  patch: { operatorEmail?: string; mode?: IntegrationMode },
): Promise<{ ok: true; seat?: AgentSeat } | { ok: false; error: string }> {
  const res = await fetch("/api/fleet/seats", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });
  const out = (await res.json().catch(() => null)) as
    | { ok?: boolean; seat?: AgentSeatRow; error?: string }
    | null;
  if (!res.ok || !out?.ok) return { ok: false, error: out?.error ?? `Seat update failed (${res.status}).` };
  return { ok: true, seat: out.seat ? agentSeatRowToSeat(out.seat) : undefined };
}
