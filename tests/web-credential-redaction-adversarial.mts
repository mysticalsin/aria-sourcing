import { runWebTool } from "../src/lib/ai/web-tools";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const secret = "tvly-special key/+?=&%25";
const percentEncoded = encodeURIComponent(secret);
const formEncoded = new URLSearchParams({ value: secret }).toString().slice("value=".length);
const doubleEncoded = encodeURIComponent(percentEncoded);
const doubleFormEncoded = new URLSearchParams({ value: formEncoded }).toString().slice("value=".length);
const secretRepresentations = [secret, percentEncoded, formEncoded, doubleEncoded, doubleFormEncoded];

const successFetch = (async (url: string | URL) => {
  if (String(url) !== "https://api.tavily.com/search") throw new Error("unexpected fallback");
  return new Response(
    JSON.stringify({
      results: [
        {
          title: `echo ${secretRepresentations.join(" | ")}`,
          url: `https://example.test/${doubleEncoded}`,
          content: `authorization=Bearer+${formEncoded}; api_key=${percentEncoded}`,
          [doubleEncoded]: { api_key: formEncoded },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

const success = await runWebTool("web_search", { query: "safe query" }, { tavilyKey: secret, fetchImpl: successFetch });
const serializedSuccess = JSON.stringify(success);
ok("Tavily success remains usable after credential scrubbing", success.ok);
ok(
  "Tavily success removes raw, percent, form, and repeatedly encoded credential echoes",
  secretRepresentations.every((representation) => !serializedSuccess.includes(representation)),
);
ok("Tavily success removes sensitive key/value echoes", !/(?:authorization|api[_-]?key)=/i.test(serializedSuccess));

const failureFetch = (async (url: string | URL) => {
  if (String(url) === "https://api.tavily.com/search") return new Response("unavailable", { status: 503 });
  throw new Error(
    `upstream echoed {"authorization":"Bearer ${doubleEncoded}","api_key":"${formEncoded}"}`,
  );
}) as typeof fetch;

const failure = await runWebTool("web_search", { query: "safe fallback query" }, { tavilyKey: secret, fetchImpl: failureFetch });
const serializedFailure = JSON.stringify(failure);
ok("web-search failure is mapped to a generic message", !failure.ok && failure.error === "Search provider unavailable.");
ok(
  "web-search errors remove raw, percent, form, and repeatedly encoded credential echoes",
  secretRepresentations.every((representation) => !serializedFailure.includes(representation)),
);
ok("web-search errors remove sensitive object-key/value echoes", !/(?:authorization|api[_-]?key|bearer)/i.test(serializedFailure));

const longSecret = `tvly-${"A".repeat(400)}`;
const longSecretPrefix = longSecret.slice(0, 120);
let longSecretCalls = 0;
const longSecretSuccessFetch = (async () => {
  longSecretCalls += 1;
  return new Response(
    JSON.stringify({
      results: [{ title: longSecret, url: "https://example.test/result", content: longSecret }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;
const longSecretSuccess = await runWebTool(
  "web_search",
  { query: "safe query" },
  { tavilyKey: longSecret, fetchImpl: longSecretSuccessFetch },
);
ok("Tavily scrubs credentials before truncating provider fields", longSecretSuccess.ok && !JSON.stringify(longSecretSuccess).includes(longSecretPrefix));
ok("long-key success uses only Tavily", longSecretCalls === 1);

let deeplyEncodedSecret = percentEncoded;
for (let layer = 0; layer < 64; layer += 1) deeplyEncodedSecret = encodeURIComponent(deeplyEncodedSecret);
const deepEncodingFetch = (async () =>
  new Response(
    JSON.stringify({ results: [{ title: deeplyEncodedSecret, url: "https://example.test/deep", content: "safe" }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
const deepEncoding = await runWebTool(
  "web_search",
  { query: "safe query" },
  { tavilyKey: secret, fetchImpl: deepEncodingFetch },
);
ok(
  "excessively nested credential encodings fail closed within a bounded decoder",
  deepEncoding.ok && !JSON.stringify(deepEncoding).includes(deeplyEncodedSecret),
);

const longSecretFallbackCalls: string[] = [];
const longSecretFailureFetch = (async (url: string | URL) => {
  longSecretFallbackCalls.push(String(url));
  if (String(url) === "https://api.tavily.com/search") return new Response("unavailable", { status: 503 });
  return new Response(JSON.stringify({ Heading: "unexpected fallback" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;
const longSecretFailure = await runWebTool(
  "web_search",
  { query: `pasted ${longSecret}` },
  { tavilyKey: longSecret, fetchImpl: longSecretFailureFetch },
);
ok("a credential truncated by the query limit still fails closed", !longSecretFailure.ok);
ok(
  "a credential truncated by the query limit never reaches DuckDuckGo",
  longSecretFallbackCalls.length === 1 && longSecretFallbackCalls[0] === "https://api.tavily.com/search",
);

console.log(`RESULT web-credential-redaction-adversarial: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
