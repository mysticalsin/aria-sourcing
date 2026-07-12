import { sendWhatsApp, sendSms } from "../src/lib/channels";

/*
 * Target: src/lib/channels.ts — real WhatsApp + SMS delivery adapters. Each
 * is token-gated: missing credentials must produce a dry-run WITHOUT ever
 * touching the network, upstream non-2xx and thrown errors must be caught
 * into the {status:"error", ...} shape (never thrown out), and an invalid
 * destination must short-circuit before fetch is called at all.
 */

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const ENV_KEYS = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
function clearChannelEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

/* ============================== WhatsApp ================================ */

// --- Not configured: dry-run, must never touch the network ------------------
clearChannelEnv();
{
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("fetch should not be called when unconfigured");
  }) as typeof fetch;
  const res = await sendWhatsApp({ to: "+14155552671", body: "hi" });
  ok("WhatsApp not configured -> dry-run", res.status === "dry-run");
  ok("WhatsApp not configured -> proven not sent", res.deliveryState === "not-sent");
  ok("WhatsApp not configured -> fetch never called", !called);
  restoreFetch();
}

process.env.WHATSAPP_TOKEN = "wa-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";

// --- Configured + upstream success ------------------------------------------
{
  let calledUrl = "";
  globalThis.fetch = (async (url: unknown) => {
    calledUrl = String(url);
    return jsonResponse(200, { messages: [{ id: "wamid.ABCD" }] });
  }) as typeof fetch;
  const res = await sendWhatsApp({ to: "+14155552671", body: "hi" });
  ok("WhatsApp success -> status sent", res.status === "sent");
  ok("WhatsApp success -> accepted delivery state", res.deliveryState === "accepted");
  ok("WhatsApp success -> id taken from the response body", res.id === "wamid.ABCD");
  ok(
    "WhatsApp success -> hits the Graph API messages endpoint for the configured phone number id",
    calledUrl.includes("graph.facebook.com") && calledUrl.includes("1234567890"),
  );
  restoreFetch();
}

// --- Approved templates use Meta's template endpoint shape, never a raw text
// message. This is how business-initiated WhatsApp outreach stays inside the
// approved-template policy outside an open reply window.
{
  let sent: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return jsonResponse(200, { messages: [{ id: "wamid.TEMPLATE" }] });
  }) as typeof fetch;
  const res = await sendWhatsApp({
    to: "+14155552671",
    kind: "approved_template",
    template: { name: "role_intro", language: "en_US", bodyParameters: ["Marco"] },
  });
  const template = sent?.template as { name?: string; language?: { code?: string }; components?: { type?: string; parameters?: { text?: string }[] }[] } | undefined;
  ok("WhatsApp template -> status sent", res.status === "sent");
  ok("WhatsApp template -> sends a template payload", sent?.type === "template");
  ok("WhatsApp template -> preserves approved template name and language", template?.name === "role_intro" && template.language?.code === "en_US");
  ok("WhatsApp template -> sends typed body parameters", template?.components?.[0]?.parameters?.[0]?.text === "Marco");
  restoreFetch();
}

// --- Configured + upstream non-2xx ------------------------------------------
{
  globalThis.fetch = (async () => jsonResponse(401, { error: "bad token" })) as typeof fetch;
  const res = await sendWhatsApp({ to: "+14155552671", body: "hi" });
  ok("WhatsApp upstream 401 -> status error", res.status === "error");
  ok("WhatsApp upstream 401 -> proven rejected", res.deliveryState === "not-sent");
  ok("WhatsApp upstream 401 -> detail mentions the status code", res.detail.includes("401"));
  restoreFetch();
}

// A 2xx response without Meta's durable message id is ambiguous. The
// dispatcher cannot reconcile it safely, so it must never be treated as sent.
{
  globalThis.fetch = (async () => jsonResponse(200, { messages: [{}] })) as typeof fetch;
  const res = await sendWhatsApp({ to: "+14155552671", body: "hi" });
  ok("WhatsApp success without provider id -> error", res.status === "error");
  ok("WhatsApp success without provider id -> ambiguous delivery", res.deliveryState === "unknown");
  ok("WhatsApp success without provider id -> explicit reconciliation detail", /message id/i.test(res.detail));
  restoreFetch();
}

// A provider 5xx can be emitted after request processing. It must not release
// the durable claim because a retry could duplicate an accepted message.
{
  globalThis.fetch = (async () => jsonResponse(503, { error: "upstream unavailable" })) as typeof fetch;
  const res = await sendWhatsApp({ to: "+14155552671", body: "hi" });
  ok("WhatsApp upstream 503 -> status error", res.status === "error");
  ok("WhatsApp upstream 503 -> ambiguous delivery", res.deliveryState === "unknown");
  restoreFetch();
}

// --- Configured + fetch throws: caught, never escapes -----------------------
{
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  const res = await sendWhatsApp({ to: "+14155552671", body: "hi" });
  ok("WhatsApp fetch throws -> caught into status error (never throws out)", res.status === "error");
  ok("WhatsApp fetch throws -> ambiguous delivery", res.deliveryState === "unknown");
  ok("WhatsApp fetch throws -> detail carries the underlying error message", res.detail === "network down");
  restoreFetch();
}

// --- Configured + no usable phone number: rejected before fetch -------------
{
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return jsonResponse(200, {});
  }) as typeof fetch;
  const res = await sendWhatsApp({ to: "not-a-phone!!", body: "hi" });
  ok("WhatsApp invalid phone -> status error", res.status === "error");
  ok("WhatsApp invalid phone -> proven not sent", res.deliveryState === "not-sent");
  ok("WhatsApp invalid phone -> fetch never called", !called);
  restoreFetch();
}

/* ============================ SMS (Twilio) =============================== */

clearChannelEnv();

// --- Not configured: dry-run, must never touch the network ------------------
{
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("fetch should not be called when unconfigured");
  }) as typeof fetch;
  const res = await sendSms({ to: "+14155552671", body: "hi" });
  ok("SMS not configured -> dry-run", res.status === "dry-run");
  ok("SMS not configured -> proven not sent", res.deliveryState === "not-sent");
  ok("SMS not configured -> fetch never called", !called);
  restoreFetch();
}

process.env.TWILIO_ACCOUNT_SID = "AC123";
process.env.TWILIO_AUTH_TOKEN = "authtoken";
process.env.TWILIO_FROM = "+15005550006";

// --- Configured + upstream success ------------------------------------------
{
  let calledUrl = "";
  globalThis.fetch = (async (url: unknown) => {
    calledUrl = String(url);
    return jsonResponse(201, { sid: "SM999" });
  }) as typeof fetch;
  const res = await sendSms({ to: "+14155552671", body: "hi" });
  ok("SMS success -> status sent", res.status === "sent");
  ok("SMS success -> accepted delivery state", res.deliveryState === "accepted");
  ok("SMS success -> id taken from the response body", res.id === "SM999");
  ok("SMS success -> hits the Twilio Messages endpoint for the configured account", calledUrl.includes("api.twilio.com") && calledUrl.includes("AC123"));
  restoreFetch();
}

// A successful HTTP status without Twilio's durable message SID cannot prove
// acceptance. Treat it as unknown so no caller can release the duplicate guard.
{
  globalThis.fetch = (async () => jsonResponse(201, {})) as typeof fetch;
  const res = await sendSms({ to: "+14155552671", body: "hi" });
  ok("SMS success without provider id -> error", res.status === "error");
  ok("SMS success without provider id -> ambiguous delivery", res.deliveryState === "unknown");
  ok("SMS success without provider id -> explicit reconciliation detail", /message sid/i.test(res.detail));
  restoreFetch();
}

// --- Configured + upstream non-2xx ------------------------------------------
{
  globalThis.fetch = (async () => jsonResponse(400, { message: "bad request" })) as typeof fetch;
  const res = await sendSms({ to: "+14155552671", body: "hi" });
  ok("SMS upstream 400 -> status error", res.status === "error");
  ok("SMS upstream 400 -> proven rejected", res.deliveryState === "not-sent");
  ok("SMS upstream 400 -> detail mentions the status code", res.detail.includes("400"));
  restoreFetch();
}

// A timeout or server error may be returned after Twilio accepted the request.
// Both states require reconciliation and must never be called retryable.
for (const status of [408, 503]) {
  globalThis.fetch = (async () => jsonResponse(status, { message: "upstream uncertain" })) as typeof fetch;
  const res = await sendSms({ to: "+14155552671", body: "hi" });
  ok(`SMS upstream ${status} -> status error`, res.status === "error");
  ok(`SMS upstream ${status} -> ambiguous delivery`, res.deliveryState === "unknown");
  restoreFetch();
}

// --- Configured + fetch throws: caught, never escapes -----------------------
{
  globalThis.fetch = (async () => {
    throw new Error("timeout");
  }) as typeof fetch;
  const res = await sendSms({ to: "+14155552671", body: "hi" });
  ok("SMS fetch throws -> caught into status error (never throws out)", res.status === "error");
  ok("SMS fetch throws -> ambiguous delivery", res.deliveryState === "unknown");
  ok("SMS fetch throws -> detail carries the underlying error message", res.detail === "timeout");
  restoreFetch();
}

// --- Configured + no usable phone number: rejected before fetch -------------
{
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return jsonResponse(200, {});
  }) as typeof fetch;
  const res = await sendSms({ to: "###", body: "hi" });
  ok("SMS invalid phone -> status error", res.status === "error");
  ok("SMS invalid phone -> proven not sent", res.deliveryState === "not-sent");
  ok("SMS invalid phone -> fetch never called", !called);
  restoreFetch();
}

/* ---- restore whatever channel env existed before this file ran ---- */
for (const k of ENV_KEYS) {
  if (savedEnv[k] === undefined) delete process.env[k];
  else process.env[k] = savedEnv[k];
}

console.log(`RESULT channels: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
