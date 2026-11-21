import { LinkedInTokenChannel, type ActionResult } from "./channel";

export interface HandlerInput {
  method: string;
  role: string;
  workspaceId: string;
  channel: LinkedInTokenChannel;
  action?: string;
  body?: Record<string, unknown>;
  e2e?: boolean;
  userId?: string | null;
  sessionWorkspaceId?: string;
  serverQcPass?: boolean;
  serverAutoOptIn?: boolean;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

function denied(): HandlerResult {
  return { status: 403, body: { ok: false, reason: "role" } };
}

function privileged(role: string): boolean {
  return role === "admin" || role === "owner";
}

const ADMIN_ACTIONS = new Set(["enable", "disable", "token", "revoke", "kill", "reset", "approval-ttl"]);
const READ_ONLY_REFUSED = new Set([
  "enable",
  "disable",
  "token",
  "revoke",
  "kill",
  "reset",
  "approve",
  "send",
  "enqueue",
  "approval-ttl",
]);

export async function handleLinkedInTokenRequest(input: HandlerInput): Promise<HandlerResult> {
  if (input.userId === null) {
    return { status: 401, body: { ok: false, reason: "unauthenticated" } };
  }
  if (input.sessionWorkspaceId && input.workspaceId && input.sessionWorkspaceId !== input.workspaceId) {
    return { status: 403, body: { ok: false, reason: "workspace" } };
  }
  const workspaceId = input.sessionWorkspaceId || input.workspaceId;
  if (!workspaceId) return { status: 401, body: { ok: false, reason: "unauthenticated" } };
  if (input.method === "GET") {
    if (!privileged(input.role)) return denied();
    const view = input.channel.view(workspaceId);
    return { status: 200, body: { ok: true, ...view } };
  }
  if (input.method !== "POST") return { status: 405, body: { ok: false, reason: "method" } };
  const action = input.action ?? "";
  const body = input.body ?? {};
  if (input.role === "viewer" && READ_ONLY_REFUSED.has(action)) return denied();
  if (ADMIN_ACTIONS.has(action) && !privileged(input.role)) return denied();
  if (action === "reset") {
    if (!input.e2e || !privileged(input.role)) return denied();
    await input.channel.reset(workspaceId);
    return { status: 200, body: { ok: true } };
  }
  if (action === "enable") {
    const result = await input.channel.enable({
      workspaceId,
      role: input.role,
      actorId: input.userId || "session-user",
      acknowledgement: String(body.acknowledgement ?? ""),
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "disable") {
    const result = await input.channel.disable({
      workspaceId,
      role: input.role,
      actorId: input.userId || "session-user",
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "kill") {
    const result = await input.channel.engageKill({ workspaceId });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "approval-ttl") {
    if (!input.e2e) return { status: 404, body: { ok: false, reason: "disabled" } };
    const seconds = Number(body.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 24 * 60 * 60) {
      return { status: 400, body: { ok: false, reason: "config" } };
    }
    await input.channel.setApprovalTtl(workspaceId, seconds * 1000);
    return { status: 200, body: { ok: true } };
  }
  if (action === "token") {
    const result = await input.channel.putToken({
      workspaceId,
      role: input.role,
      actorId: input.userId || "session-user",
      token: String(body.token ?? ""),
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "revoke") {
    const result = await input.channel.revoke({
      workspaceId,
      role: input.role,
      actorId: input.userId || "session-user",
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "approve") {
    const result = await input.channel.approveFromServer({
      workspaceId,
      nonce: String(body.nonce ?? ""),
      recipient: String(body.recipient ?? ""),
      subject: String(body.subject ?? ""),
      body: String(body.body ?? ""),
      mode: body.mode === "auto" ? "auto" : "manual",
      userId: input.userId || "session-user",
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "send" || action === "enqueue") {
    const result = await input.channel.sendUsingStored({
      workspaceId,
      nonce: String(body.nonce ?? ""),
      recipient: String(body.recipient ?? ""),
      subject: String(body.subject ?? ""),
      body: String(body.body ?? ""),
      mode: body.mode === "auto" ? "auto" : "manual",
      actorId: input.userId || "session-user",
      hold: body.hold === true,
      fakeStatus: numberOrUndefined(body.fakeStatus),
      challenge: body.challenge === true,
      delayMs: numberOrUndefined(body.delayMs),
      enqueue: action === "enqueue",
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  return { status: 400, body: { ok: false, reason: "action" } };
}

function outcome(result: ActionResult, channel: LinkedInTokenChannel, workspaceId: string, role: string): HandlerResult {
  const view = privileged(role) ? channel.view(workspaceId) : {};
  return { status: result.ok ? 200 : 409, body: { ...result, ...view } };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
