import { sendViaProvider } from "../src/lib/providers";
import { sendViaGmailApi, sendViaMicrosoftGraph } from "../src/lib/email-oauth";
import type { EmailConnection } from "../src/lib/types";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalError = console.error;
const originalResendKey = process.env.RESEND_API_KEY;
const originalSendGridKey = process.env.SENDGRID_API_KEY;
const logs: string[] = [];
const UNSUBSCRIBE_URL = "https://aria.example.test/api/unsubscribe/abcDEF0123456789_abcDEF0123456789_abcDEF01234";

try {
  console.log = ((...args: unknown[]) => logs.push(args.map(String).join(" "))) as typeof console.log;
  console.error = ((...args: unknown[]) => logs.push(args.map(String).join(" "))) as typeof console.error;
  process.env.RESEND_API_KEY = "re_live_supersecretvalue";
  delete process.env.SENDGRID_API_KEY;

  const missingLink = await sendViaProvider({
    provider: "Resend",
    from: "owner@acme.example",
    to: "candidate@example.test",
    subject: "Role",
    body: "Hello",
  });
  ok("provider refuses a live send without a compliant unsubscribe link", missingLink.status === "error");

  let resendPayload: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    resendPayload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return jsonResponse(200, { id: "email-1" });
  }) as typeof fetch;
  const sent = await sendViaProvider({
    provider: "Resend",
    from: "owner@acme.example",
    to: "candidate@example.test",
    subject: "Role",
    body: "Hello",
    unsubscribeUrl: UNSUBSCRIBE_URL,
  });
  const successfulLog = logs.join("\n");
  ok("provider logs do not expose raw sender email", !successfulLog.includes("owner@acme.example"));
  ok("provider logs do not expose raw recipient email", !successfulLog.includes("candidate@example.test"));
  ok("provider logs retain the audit message", successfulLog.includes("Send attempt"));
  ok("Resend success remains a sent outcome", sent.status === "sent" && sent.id === "email-1");
  const successfulPayload = asRecord(resendPayload);
  const successfulHeaders = asRecord(successfulPayload?.headers);
  ok("Resend includes standard one-click unsubscribe headers", successfulHeaders?.["List-Unsubscribe"] === `<${UNSUBSCRIBE_URL}>`);
  ok("Resend includes an unsubscribe footer", String(successfulPayload?.text).includes(UNSUBSCRIBE_URL));

  logs.length = 0;
  globalThis.fetch = (async () =>
    jsonResponse(422, {
      message: "candidate@example.test rejected Bearer re_live_supersecretvalue",
    })) as typeof fetch;
  const failed = await sendViaProvider({
    provider: "Resend",
    from: "owner@acme.example",
    to: "candidate@example.test",
    subject: "Role",
    body: "Hello",
    unsubscribeUrl: UNSUBSCRIBE_URL,
  });
  const failureLog = logs.join("\n");
  ok("Resend error does not return provider response text", failed.detail === "Resend send error 422.");
  ok("provider failure logs do not expose raw recipient email", !failureLog.includes("candidate@example.test"));
  ok("provider failure logs do not expose raw API key", !failureLog.includes("re_live_supersecretvalue"));

  globalThis.fetch = (async () =>
    jsonResponse(400, { error: { message: "candidate@example.test invalid recipient" } })) as typeof fetch;
  const oauthFailed = await sendViaGmailApi(
    { from: "owner@acme.example", to: "candidate@example.test", subject: "Role", body: "Hello", unsubscribeUrl: UNSUBSCRIBE_URL },
    {
      id: "conn-1",
      seatId: "seat-1",
      provider: "Gmail API",
      accountEmail: "owner@acme.example",
      accessToken: "access-token",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      scope: "mail.send",
      connectedAt: "",
      updatedAt: "",
    } satisfies EmailConnection,
  );
  ok("Gmail error does not return provider response text", oauthFailed.detail === "Gmail API error 400.");

  let gmailRaw = "";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { raw?: string };
    gmailRaw = Buffer.from(payload.raw ?? "", "base64url").toString("utf8");
    return jsonResponse(200, { id: "gmail-1" });
  }) as typeof fetch;
  const gmailSent = await sendViaGmailApi(
    { from: "owner@acme.example", to: "candidate@example.test", subject: "Role", body: "Hello", unsubscribeUrl: UNSUBSCRIBE_URL },
    {
      id: "conn-2",
      seatId: "seat-1",
      provider: "Gmail API",
      accountEmail: "owner@acme.example",
      accessToken: "access-token",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      scope: "mail.send",
      connectedAt: "",
      updatedAt: "",
    } satisfies EmailConnection,
  );
  ok("Gmail MIME includes one-click unsubscribe headers", gmailSent.status === "sent" && gmailRaw.includes(`List-Unsubscribe: <${UNSUBSCRIBE_URL}>`) && gmailRaw.includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click"));
  ok("Gmail MIME includes an unsubscribe footer", gmailRaw.includes(UNSUBSCRIBE_URL));

  let graphMime = "";
  let graphContentType = "";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    graphMime = Buffer.from(String(init?.body ?? ""), "base64").toString("utf8");
    graphContentType = String((init?.headers as Record<string, string> | undefined)?.["Content-Type"] ?? "");
    return jsonResponse(202, {});
  }) as typeof fetch;
  const graphSent = await sendViaMicrosoftGraph(
    { from: "owner@acme.example", to: "candidate@example.test", subject: "Role", body: "Hello", unsubscribeUrl: UNSUBSCRIBE_URL },
    {
      id: "conn-3",
      seatId: "seat-1",
      provider: "Microsoft Graph",
      accountEmail: "owner@acme.example",
      accessToken: "access-token",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      scope: "mail.send",
      connectedAt: "",
      updatedAt: "",
    } satisfies EmailConnection,
  );
  ok("Graph sends MIME rather than a restricted JSON custom-header shape", graphSent.status === "sent" && graphContentType === "text/plain");
  ok("Graph MIME includes standard unsubscribe headers", graphMime.includes(`List-Unsubscribe: <${UNSUBSCRIBE_URL}>`) && graphMime.includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click"));
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.error = originalError;
  if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendKey;
  if (originalSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
  else process.env.SENDGRID_API_KEY = originalSendGridKey;
}

console.log(`RESULT providers: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
