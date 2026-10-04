import {
  recordOutreachApproval,
  revokeOutreachApproval,
  type OutreachApprovalRequest,
} from "../src/lib/outreach-approval";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const request: OutreachApprovalRequest = {
  messageId: "msg-1",
  candidateId: "candidate-1",
  channel: "Email",
  recipient: "candidate@example.test",
  subject: "A role you may like",
  body: "Hello from Aria.",
};

function response(okValue: boolean, status = 200, body: unknown = { ok: okValue }) {
  return {
    ok: okValue,
    status,
    json: async () => body,
  } as Response;
}

{
  let captured: RequestInit | undefined;
  const result = await recordOutreachApproval(request, async (_url, init) => {
    captured = init;
    return response(true);
  });
  ok("approval persistence accepts an explicit successful response", result.ok);
  ok("approval persistence uses a POST", captured?.method === "POST");
  ok("approval persistence sends the exact approval payload", captured?.body === JSON.stringify(request));
}

{
  const simulated = await recordOutreachApproval(request, async () =>
    response(true, 200, {
      ok: true,
      status: "dry-run",
      persisted: false,
      detail: "Public demo: approval is simulated.",
    }),
  );
  ok("approval persistence exposes a typed public-demo result", simulated.ok && simulated.dryRun === true);
  ok("approval persistence preserves the public-demo explanation", simulated.ok && simulated.detail === "Public demo: approval is simulated.");
}

for (const failedResponse of [
  response(false, 200, { ok: false, error: "not recorded" }),
  response(false, 401, { ok: false }),
  response(false, 403, { ok: false }),
  response(false, 500, { ok: false }),
  response(true, 200, { unexpected: true }),
]) {
  const result = await recordOutreachApproval(request, async () => failedResponse);
  ok(`approval persistence rejects non-confirmed status ${failedResponse.status}`, !result.ok);
}

{
  const malformed = await recordOutreachApproval(
    request,
    async () => new Response("{", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  ok("approval persistence rejects malformed success bodies", !malformed.ok);

  const unavailable = await recordOutreachApproval(request, async () => {
    throw new Error("network unavailable");
  });
  ok("approval persistence rejects network errors", !unavailable.ok);
}

{
  let captured: RequestInit | undefined;
  const revoked = await revokeOutreachApproval("msg-1", async (_url, init) => {
    captured = init;
    return response(true);
  });
  ok("approval revocation accepts an explicit successful response", revoked.ok);
  ok("approval revocation uses a POST", captured?.method === "POST");
  ok("approval revocation sends only the message id", captured?.body === JSON.stringify({ messageId: "msg-1" }));

  const simulated = await revokeOutreachApproval("msg-1", async () =>
    response(true, 200, { ok: true, status: "dry-run", persisted: false, detail: "Public demo only." }),
  );
  ok("approval revocation exposes a typed public-demo result", simulated.ok && simulated.dryRun === true);

  const conflict = await revokeOutreachApproval("msg-1", async () => response(false, 409, { ok: false }));
  ok("approval revocation rejects a send-cutoff conflict", !conflict.ok);
  const unavailable = await revokeOutreachApproval("msg-1", async () => {
    throw new Error("network unavailable");
  });
  ok("approval revocation rejects network errors", !unavailable.ok);
}

console.log(`RESULT approval-persistence: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
