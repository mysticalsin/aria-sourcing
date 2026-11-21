import { LinkedInTokenChannel, type ActionResult, type SendInput } from "./channel";

export interface HandlerInput {
  method: string;
  role: string;
  workspaceId: string;
  channel: LinkedInTokenChannel;
  action?: string;
  body?: Record<string, unknown>;
  e2e?: boolean;
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

export async function handleLinkedInTokenRequest(input: HandlerInput): Promise<HandlerResult> {
  const workspaceId = input.workspaceId || "synthetic-workspace";
  if (input.method === "GET") {
    if (!privileged(input.role)) return denied();
    const view = input.channel.view(workspaceId);
    return { status: 200, body: { ok: true, ...view } };
  }
  if (input.method !== "POST") return { status: 405, body: { ok: false, reason: "method" } };
  const action = input.action ?? "";
  const body = input.body ?? {};
  if (action === "reset") {
    if (!input.e2e || !privileged(input.role)) return denied();
    await input.channel.reset(workspaceId);
    return { status: 200, body: { ok: true } };
  }
  if (action === "enable" || action === "disable" || action === "kill") {
    if (!privileged(input.role)) return denied();
  }
  if (action === "enable") {
    const result = await input.channel.enable({
      workspaceId,
      role: input.role,
      actorId: String(body.actorId ?? "operator"),
      acknowledgement: String(body.acknowledgement ?? ""),
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "disable") {
    const result = await input.channel.disable({
      workspaceId,
      role: input.role,
      actorId: String(body.actorId ?? "operator"),
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "kill") {
    const result = await input.channel.applyKillSwitch({ workspaceId });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "token") {
    const result = await input.channel.putToken({
      workspaceId,
      role: input.role,
      actorId: String(body.actorId ?? "operator"),
      token: String(body.token ?? ""),
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "revoke") {
    const result = await input.channel.revoke({
      workspaceId,
      role: input.role,
      actorId: String(body.actorId ?? "operator"),
    });
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "approve") {
    const result = await input.channel.approve(approvalFrom(workspaceId, body));
    return outcome(result, input.channel, workspaceId, input.role);
  }
  if (action === "send" || action === "enqueue") {
    const send: SendInput = { ...approvalFrom(workspaceId, body), actorId: String(body.actorId ?? "operator"), hold: body.hold === true, fakeStatus: numberOrUndefined(body.fakeStatus), challenge: body.challenge === true, delayMs: numberOrUndefined(body.delayMs) };
    const result = action === "enqueue" ? await input.channel.enqueue(send) : await input.channel.send(send);
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

function approvalFrom(workspaceId: string, body: Record<string, unknown>) {
  return {
    workspaceId,
    nonce: String(body.nonce ?? ""),
    recipient: String(body.recipient ?? ""),
    subject: String(body.subject ?? ""),
    body: String(body.body ?? ""),
    mode: body.mode === "auto" ? "auto" as const : "manual" as const,
    qcPass: body.qcPass === true,
    autoOptIn: body.autoOptIn === true,
    senderId: String(body.senderId ?? "sender-synthetic"),
    issuedAt: typeof body.issuedAt === "number" ? body.issuedAt : Date.now(),
    expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : Date.now() + 60 * 60 * 1000,
  };
}
