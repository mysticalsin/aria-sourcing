import { z } from "zod";
import { isAllowedHermesUrl } from "../src/lib/api/url";
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

/* ---- validateBody helper ---- */
const TestSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().min(0),
});

async function makeRequest(body: unknown, contentLength?: number): Promise<Request> {
  return new Request("http://localhost/api/test", {
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

  const invalidJson = new Request("http://localhost/api/test", {
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
  } as unknown as Request;
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
  } as unknown as Request;
  const streamedRejected = await validateBody(streamedOversize, TestSchema, { maxBytes: 100 });
  ok(
    "chunked oversized bodies stop at max plus one and cancel the reader",
    !streamedRejected.ok && streamedReadCalls === 2 && streamedCancelCalls === 1,
  );
}

await testValidate();

console.log(`RESULT api-validation: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
