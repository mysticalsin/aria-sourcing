/* tests/public-fetch.mts - connection-safe public egress contract
 * Run: npx tsx tests/public-fetch.mts
 */
import {
  createPinnedLookup,
  fetchPublicUrl,
  type PublicFetchTransport,
  type PublicResolver,
} from "../src/lib/api/public-fetch";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

{
  let transportCalls = 0;
  const resolver: PublicResolver = async () => [{ address: "127.0.0.1", family: 4 }];
  const transport: PublicFetchTransport = async () => {
    transportCalls += 1;
    return new Response("should not connect");
  };
  await rejects(
    "private DNS answer is rejected before connect",
    () => fetchPublicUrl("https://example.test/data", {}, { resolver, transport }),
    /private|non-public|blocked/i,
  );
  ok("blocked DNS answer never reaches transport", transportCalls === 0);
}

{
  let transportCalls = 0;
  const neverResolving: PublicResolver = async () => await new Promise<readonly never[]>(() => {});
  const transport: PublicFetchTransport = async () => {
    transportCalls += 1;
    return new Response("unexpected");
  };
  const startedAt = Date.now();
  const outcome = await Promise.race([
    fetchPublicUrl("https://deadline.example.test/", { timeoutMs: 20 }, { resolver: neverResolving, transport })
      .then(() => "unexpected-success")
      .catch((error) => (/timeout|deadline/i.test(error instanceof Error ? error.message : String(error)) ? "timed-out" : "wrong-error")),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 250)),
  ]);
  ok("absolute deadline includes DNS resolution", outcome === "timed-out" && Date.now() - startedAt < 250);
  ok("a DNS result arriving after the deadline can never start transport", transportCalls === 0);
}

{
  let resolverCalls = 0;
  const resolver: PublicResolver = async () => {
    resolverCalls += 1;
    return [{ address: "93.184.216.34", family: 4 }];
  };
  const transport: PublicFetchTransport = async () => new Response("unexpected");
  await rejects(
    "credential-bearing POST over HTTP is rejected before DNS",
    () => fetchPublicUrl("http://example.test/api", { method: "POST", body: "{}" }, { resolver, transport }),
    /https/i,
  );
  await rejects(
    "plain HTTP public requests are rejected before DNS",
    () => fetchPublicUrl("http://example.test/read", { method: "GET" }, { resolver, transport }),
    /https/i,
  );
  await rejects(
    "GET bodies are rejected before DNS",
    () => fetchPublicUrl("https://example.test/read", { method: "GET", body: "secret" }, { resolver, transport }),
    /body/i,
  );
  await rejects(
    "non-standard public ports are rejected before DNS",
    () => fetchPublicUrl("https://example.test:8443/", {}, { resolver, transport }),
    /port/i,
  );
  await rejects(
    "request bodies are byte capped before DNS or connect",
    () => fetchPublicUrl("https://example.test/", { method: "POST", body: "01234567890", maxRequestBytes: 10 }, { resolver, transport }),
    /byte limit/i,
  );
  let oversizedBlobRead = false;
  class OversizedBlob extends Blob {
    override async arrayBuffer(): Promise<ArrayBuffer> {
      oversizedBlobRead = true;
      return await super.arrayBuffer();
    }
  }
  await rejects(
    "oversized Blob bodies are rejected before materialization",
    () =>
      fetchPublicUrl(
        "https://example.test/",
        { method: "POST", body: new OversizedBlob(["01234567890"]), maxRequestBytes: 10 },
        { resolver, transport },
      ),
    /byte limit/i,
  );
  ok("oversized Blob arrayBuffer is never allocated", oversizedBlobRead === false);
  await rejects(
    "oversized URLs are rejected before DNS",
    () => fetchPublicUrl(`https://example.test/${"x".repeat(9_000)}`, {}, { resolver, transport }),
    /URL.*limit|URL.*large/i,
  );
  await rejects(
    "oversized request headers are rejected before DNS",
    () =>
      fetchPublicUrl(
        "https://example.test/",
        { headers: { "x-large": "x".repeat(17_000) } },
        { resolver, transport },
      ),
    /header.*limit|header.*large/i,
  );
  ok("invalid request policy never performs DNS", resolverCalls === 0);
}

{
  let transportCalls = 0;
  const resolver: PublicResolver = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.5", family: 4 },
  ];
  const transport: PublicFetchTransport = async () => {
    transportCalls += 1;
    return new Response("should not connect");
  };
  await rejects(
    "mixed public and private DNS answers fail closed",
    () => fetchPublicUrl("https://example.test/data", {}, { resolver, transport }),
    /private|non-public|blocked/i,
  );
  ok("mixed DNS answer never reaches transport", transportCalls === 0);
}

{
  let resolverCalls = 0;
  let pinnedAddress = "";
  let seenUrl = "";
  const resolver: PublicResolver = async () => {
    resolverCalls += 1;
    return resolverCalls === 1
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }];
  };
  const transport: PublicFetchTransport = async ({ url, address }) => {
    pinnedAddress = address.address;
    seenUrl = url.toString();
    return new Response("pinned", { status: 200 });
  };
  const response = await fetchPublicUrl(
    "https://example.test/data?q=1",
    { method: "GET", redirect: "manual" },
    { resolver, transport },
  );
  ok("resolver runs exactly once per request", resolverCalls === 1);
  ok("transport receives the validated address", pinnedAddress === "93.184.216.34");
  ok("transport preserves the original TLS hostname URL", seenUrl === "https://example.test/data?q=1");
  ok("pinned transport response is returned", response.status === 200 && (await response.text()) === "pinned");
}

{
  let resolverCalls = 0;
  const resolver: PublicResolver = async () => {
    resolverCalls += 1;
    return [];
  };
  const transport: PublicFetchTransport = async ({ address }) => new Response(address.address);
  const response = await fetchPublicUrl("https://93.184.216.34/", {}, { resolver, transport });
  ok("public IP literals do not invoke DNS", resolverCalls === 0);
  ok("public IP literal itself is pinned", (await response.text()) === "93.184.216.34");
}

{
  const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
  const single = await new Promise<{ address: string; family: number }>((resolve, reject) => {
    lookup("example.test", { family: 0, all: false }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address: String(address), family: Number(family) });
    });
  });
  ok("socket lookup returns the prevalidated address", single.address === "93.184.216.34" && single.family === 4);
}

{
  const sourceFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    });
  const webTools = readFileSync("src/lib/ai/web-tools.ts", "utf8");
  const mcpClient = readFileSync("src/lib/mcp-client.ts", "utf8");
  const browserTools = readFileSync("src/lib/ai/browser-tools.ts", "utf8");
  const publicFetchSource = readFileSync("src/lib/api/public-fetch.ts", "utf8");
  const packageSource = readFileSync("package.json", "utf8");
  ok(
    "public web tools use the pinned transport for every request",
    webTools.includes("fetchPublicUrl") && !/(?<!PublicUrl)\bfetch\s*\(/.test(webTools),
  );
  ok(
    "MCP handshakes and tool calls use the pinned transport",
    mcpClient.includes("fetchPublicUrl") && !/(?<!PublicUrl)\bfetch\s*\(/.test(mcpClient),
  );
  ok(
    "browser robots checks use the pinned transport",
    browserTools.includes("fetchPublicUrl") &&
      !/await\s+fetch\s*\(robotsUrl/.test(browserTools) &&
      (browserTools.match(/assertPublicUrl\(/g) ?? []).length === 1,
  );
  for (const route of [
    "src/app/api/agents/run/route.ts",
    "src/app/api/hermes/chat/route.ts",
    "src/app/api/integrations/databricks/config/route.ts",
    "src/app/api/integrations/databricks/needs/route.ts",
    "src/app/api/mcp/test/route.ts",
  ]) {
    ok(
      `${route} does not perform an unbound duplicate DNS preflight`,
      !readFileSync(route, "utf8").includes("assertPublicUrl"),
    );
  }
  ok(
    "pinned transport rejects unsolicited protocol upgrades",
    /request\.on\(["']upgrade["']/.test(publicFetchSource) && /socket\.destroy\(\)/.test(publicFetchSource),
  );
  ok(
    "pinned transport rejects close-before-settle",
    /request\.on\(["']close["'][\s\S]*?finishReject/.test(publicFetchSource),
  );
  ok(
    "pinned transport sets an explicit response-header ceiling",
    /maxHeaderSize\s*:/.test(publicFetchSource),
  );
  ok(
    "the direct transport test seam has no production import",
    sourceFiles("src")
      .filter((path) => path.replaceAll("\\", "/") !== "src/lib/api/public-fetch.ts")
      .every((path) => !readFileSync(path, "utf8").includes("_testOnlyNodeTransport")),
  );
  ok(
    "targeted security suite runs the public egress contract",
    /"test:security"\s*:\s*"[^"]*tests\/public-fetch\.mts/.test(packageSource),
  );
  for (const route of [
    "src/app/api/agents/run/route.ts",
    "src/app/api/hermes/chat/route.ts",
    "src/app/api/integrations/databricks/config/route.ts",
    "src/app/api/integrations/databricks/needs/route.ts",
    "src/app/api/mcp/test/route.ts",
    "src/app/api/source/route.ts",
    "src/app/api/sourcing-agent/route.ts",
  ]) {
    ok(
      `${route} is pinned to the Node runtime`,
      /export const runtime\s*=\s*["']nodejs["']/.test(readFileSync(route, "utf8")),
    );
  }
}

console.log(`RESULT public-fetch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
