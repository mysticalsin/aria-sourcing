import { z } from "zod";
import { NextRequest } from "next/server";
import { hermesRuntimeMisconfigured, isAllowedHermesUrl } from "../src/lib/api/url";
import { validateBody } from "../src/lib/api/validate";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- SSRF URL allow-list ---- */
ok("Aria default localhost allowed", isAllowedHermesUrl("http://127.0.0.1:8642").ok);
ok("HTTPS localhost allowed", isAllowedHermesUrl("https://localhost:8642").ok);
ok("Private 10.x allowed", isAllowedHermesUrl("http://10.0.0.5:8642").ok);
ok("Private 192.168 allowed", isAllowedHermesUrl("http://192.168.1.5:8642").ok);
ok("Docker host allowed", isAllowedHermesUrl("http://host.docker.internal:8642").ok);
ok("Public internet blocked", !isAllowedHermesUrl("https://example.com").ok);
ok("Metadata endpoint blocked", !isAllowedHermesUrl("http://metadata.google.internal").ok);
ok("AWS metadata blocked", !isAllowedHermesUrl("http://169.254.169.254/latest/meta-data").ok);
ok("Loopback variant 127.0.0.2 blocked", !isAllowedHermesUrl("http://127.0.0.2:8642").ok);
ok("File scheme blocked", !isAllowedHermesUrl("file:///etc/passwd").ok);
ok("FTP scheme blocked", !isAllowedHermesUrl("ftp://127.0.0.1").ok);
ok("Invalid URL blocked", !isAllowedHermesUrl("not-a-url").ok);

/* ---- deployment-owned Hermes host allow-list (HERMES_ALLOWED_HOSTS) ----
   The built-in patterns only cover loopback and RFC1918, so no host reachable in
   a real Fly deployment (`<app>.internal` on 6PN) could ever pass and the live
   runtime silently degraded to the mock. The deployment now names its own hosts
   exactly. These assertions pin that it stays an allow-list. */
const savedAllowedHosts = process.env.HERMES_ALLOWED_HOSTS;
function withAllowedHosts<T>(value: string | undefined, run: () => T): T {
  if (value === undefined) delete process.env.HERMES_ALLOWED_HOSTS;
  else process.env.HERMES_ALLOWED_HOSTS = value;
  try {
    return run();
  } finally {
    if (savedAllowedHosts === undefined) delete process.env.HERMES_ALLOWED_HOSTS;
    else process.env.HERMES_ALLOWED_HOSTS = savedAllowedHosts;
  }
}

ok(
  "Fly .internal host rejected when the deployment has not named it",
  withAllowedHosts(undefined, () => !isAllowedHermesUrl("http://aria-mantu-hermes.internal:8642").ok),
);
ok(
  "Fly .internal host allowed once named exactly",
  withAllowedHosts("aria-mantu-hermes.internal", () => isAllowedHermesUrl("http://aria-mantu-hermes.internal:8642").ok),
);
ok(
  "6PN IPv6 literal allowed once named exactly",
  withAllowedHosts("fdaa:0:1234::3", () => isAllowedHermesUrl("http://[fdaa:0:1234::3]:8642").ok),
);
// WHATWG URL.hostname keeps the brackets on an IPv6 literal, so every IPv6
// block pattern in the validator was previously unreachable. Harmless while
// default-deny rejected all IPv6; not harmless once a deployment can name one.
ok(
  "IPv6 loopback is blocked, proving the bracket-stripped block patterns fire",
  withAllowedHosts("::1", () => !isAllowedHermesUrl("http://[::1]:8642").ok),
);
ok(
  "IPv6 link-local and multicast stay blocked even when named",
  withAllowedHosts("fe80::1,ff00::1", () =>
    !isAllowedHermesUrl("http://[fe80::1]:8642").ok && !isAllowedHermesUrl("http://[ff00::1]:8642").ok),
);
ok(
  "a named host does not admit its siblings",
  withAllowedHosts("aria-mantu-hermes.internal", () => !isAllowedHermesUrl("http://other-app.internal:8642").ok),
);
ok(
  "wildcard entries are not a pattern language",
  withAllowedHosts("*.internal", () => !isAllowedHermesUrl("http://aria-mantu-hermes.internal:8642").ok),
);
ok(
  "bare suffix entries do not admit a subdomain",
  withAllowedHosts("internal", () => !isAllowedHermesUrl("http://aria-mantu-hermes.internal:8642").ok),
);
// A public host reaches the runtime only when the DEPLOYMENT names it. This is an
// operator decision expressed in server-side env at deploy time, never from
// request data, so it widens egress deliberately and not by user input. Asserted
// in both directions so the distinction cannot rot into "public hosts are fine".
ok(
  "an unnamed public host is refused",
  withAllowedHosts(undefined, () => !isAllowedHermesUrl("https://runtime.example.com").ok),
);
ok(
  "a public host is reachable only because the deployment named it exactly",
  withAllowedHosts("runtime.example.com", () =>
    isAllowedHermesUrl("https://runtime.example.com").ok &&
    !isAllowedHermesUrl("https://other.example.com").ok),
);
ok(
  "naming a cloud metadata endpoint cannot unblock it (block-list wins)",
  withAllowedHosts("metadata.google.internal,169.254.169.254", () =>
    !isAllowedHermesUrl("http://metadata.google.internal").ok &&
    !isAllowedHermesUrl("http://169.254.169.254/latest/meta-data").ok),
);
ok(
  "an entry carrying a scheme or path is ignored",
  withAllowedHosts("http://aria-mantu-hermes.internal/x", () => !isAllowedHermesUrl("http://aria-mantu-hermes.internal:8642").ok),
);
ok(
  "built-in loopback still allowed with an unrelated allow-list set",
  withAllowedHosts("aria-mantu-hermes.internal", () => isAllowedHermesUrl("http://127.0.0.1:8642").ok),
);

/* ---- silent-misconfiguration detector consumed by readiness ---- */
ok(
  "unconfigured Hermes is not a misconfiguration",
  withAllowedHosts(undefined, () => !hermesRuntimeMisconfigured(undefined) && !hermesRuntimeMisconfigured("   ")),
);
ok(
  "a configured but unroutable Hermes URL is a misconfiguration",
  withAllowedHosts(undefined, () => hermesRuntimeMisconfigured("http://aria-mantu-hermes.internal:8642")),
);
ok(
  "a configured and named Hermes URL is not a misconfiguration",
  withAllowedHosts("aria-mantu-hermes.internal", () => !hermesRuntimeMisconfigured("http://aria-mantu-hermes.internal:8642")),
);

/* ---- validateBody helper ---- */
const TestSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().min(0),
});

async function makeRequest(body: unknown, contentLength?: number): Promise<NextRequest> {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(contentLength !== undefined ? { "content-length": String(contentLength) } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function testValidate() {
  const valid = await validateBody(await makeRequest({ name: "Aria", count: 5 }), TestSchema);
  ok("valid body accepted", valid.ok && valid.data.name === "Aria" && valid.data.count === 5);

  const missing = await validateBody(await makeRequest({ name: "Aria" }), TestSchema);
  ok("missing field rejected", !missing.ok);

  const badType = await validateBody(await makeRequest({ name: "Aria", count: "five" }), TestSchema);
  ok("wrong type rejected", !badType.ok);

  const oversized = await validateBody(await makeRequest({ name: "x" }), TestSchema, { maxBytes: 1 });
  ok("oversized body rejected", !oversized.ok);

  const invalidJson = new NextRequest("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", "content-length": "5" },
    body: "{bad",
  });
  const badJson = await validateBody(invalidJson, TestSchema);
  ok("invalid JSON rejected", !badJson.ok);

  let earlyReadCalls = 0;
  const declaredOversize = {
    headers: new Headers({ "content-length": "5000" }),
    body: {
      getReader: () => ({
        read: async () => {
          earlyReadCalls += 1;
          return { done: true, value: undefined };
        },
        cancel: async () => undefined,
      }),
    },
  } as unknown as NextRequest;
  const earlyRejected = await validateBody(declaredOversize, TestSchema, { maxBytes: 100 });
  ok("declared oversized bodies are rejected before reading", !earlyRejected.ok && earlyReadCalls === 0);

  let streamedReadCalls = 0;
  let streamedCancelCalls = 0;
  const chunks = [new Uint8Array(60), new Uint8Array(60), new Uint8Array(60)];
  const streamedOversize = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => {
          const value = chunks[streamedReadCalls];
          streamedReadCalls += 1;
          return value ? { done: false, value } : { done: true, value: undefined };
        },
        cancel: async () => {
          streamedCancelCalls += 1;
        },
      }),
    },
  } as unknown as NextRequest;
  const streamedRejected = await validateBody(streamedOversize, TestSchema, { maxBytes: 100 });
  ok(
    "chunked oversized bodies stop at max plus one and cancel the reader",
    !streamedRejected.ok && streamedReadCalls === 2 && streamedCancelCalls === 1,
  );
}

await testValidate();

console.log(`RESULT api-validation: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
