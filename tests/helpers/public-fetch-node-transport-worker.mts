import { createServer } from "node:https";
import type { TLSSocket } from "node:tls";
import { readFileSync } from "node:fs";
import { _testOnlyNodeTransport } from "../../src/lib/api/public-fetch";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

async function rejects(name: string, fn: () => Promise<unknown>, pattern: RegExp) {
  try {
    await fn();
    ok(name, false);
  } catch (error) {
    ok(name, pattern.test(error instanceof Error ? error.message : String(error)));
  }
}

const keyPath = process.env.PUBLIC_FETCH_TEST_KEY;
const certPath = process.env.PUBLIC_FETCH_TEST_CERT;
if (!keyPath || !certPath) throw new Error("Missing generated TLS test fixture paths.");

let targetCalls = 0;
let seenHost = "";
let seenServerName = "";
const server = createServer(
  { key: readFileSync(keyPath), cert: readFileSync(certPath) },
  (request, response) => {
    const path = request.url ?? "/";
    if (path === "/ok") {
      seenHost = request.headers.host ?? "";
      const serverName = (request.socket as TLSSocket).servername;
      seenServerName = typeof serverName === "string" ? serverName : "";
      response.end("ok");
      return;
    }
    if (path === "/redirect") {
      response.writeHead(301, { location: "/target" });
      response.end();
      return;
    }
    if (path === "/target") {
      targetCalls += 1;
      response.end("followed");
      return;
    }
    if (path === "/no-content") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === "/compressed") {
      response.writeHead(200, { "content-encoding": "gzip" });
      response.end("compressed");
      return;
    }
    if (path === "/declared-large") {
      response.writeHead(200, { "content-length": "101" });
      response.end();
      return;
    }
    if (path === "/stream-large") {
      response.writeHead(200);
      response.write("x".repeat(60));
      response.end("y".repeat(60));
      return;
    }
    if (path === "/slow") return;
    if (path === "/invalid-status") {
      response.writeHead(700);
      response.end("invalid");
      return;
    }
    if (path === "/upgrade") {
      response.writeHead(101, { connection: "Upgrade", upgrade: "test" });
      response.end();
      return;
    }
    if (path === "/large-header") {
      response.writeHead(200, { "x-large": "x".repeat(17_000) });
      response.end("large header");
      return;
    }
    response.writeHead(404);
    response.end();
  },
);

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("TLS test server did not bind an IP socket.");
const port = address.port;

function request(
  path: string,
  options: { hostname?: string; maxResponseBytes?: number; timeoutMs?: number } = {},
) {
  const hostname = options.hostname ?? "localhost";
  return _testOnlyNodeTransport({
    url: new URL(`https://${hostname}:${port}${path}`),
    address: { address: "127.0.0.1", family: 4 },
    init: { method: "GET" },
    requestBody: null,
    maxResponseBytes: options.maxResponseBytes ?? 1_000,
    timeoutMs: options.timeoutMs ?? 1_000,
  });
}

try {
  const normal = await request("/ok");
  ok("pinned TLS request succeeds with the original hostname", normal.status === 200 && (await normal.text()) === "ok");
  ok("HTTP Host preserves the original hostname", seenHost === `localhost:${port}`);
  ok("TLS SNI preserves the original hostname", seenServerName === "localhost");

  await rejects(
    "TLS certificate hostname mismatch is rejected",
    () => request("/ok", { hostname: "wrong.example" }),
    /hostname|certificate|altname/i,
  );

  const redirect = await request("/redirect");
  ok("redirect responses are returned without following", redirect.status === 301 && targetCalls === 0);
  const noContent = await request("/no-content");
  ok("no-content responses construct without a body", noContent.status === 204 && (await noContent.text()) === "");

  await rejects("compressed responses are rejected", () => request("/compressed"), /compressed/i);
  await rejects(
    "declared response length is capped",
    () => request("/declared-large", { maxResponseBytes: 100 }),
    /byte limit/i,
  );
  await rejects(
    "streamed response length is capped",
    () => request("/stream-large", { maxResponseBytes: 100 }),
    /byte limit/i,
  );
  await rejects("total transport timeout is enforced", () => request("/slow", { timeoutMs: 30 }), /timeout/i);
  await rejects("invalid HTTP status is rejected", () => request("/invalid-status"), /invalid status/i);
  await rejects("protocol upgrades are rejected", () => request("/upgrade"), /upgrade/i);
  await rejects("response headers have an explicit byte ceiling", () => request("/large-header"), /header overflow/i);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log(`RESULT public-fetch-node-transport-worker: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
