import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import {
  LINKEDIN_RSC_SOURCE,
  LINKEDIN_TOKEN_CHANNEL_EXACT_TEXT_APPROVAL,
  SYNTHETIC_WORKSPACE_CANDIDATES,
  applyRscQualityBar,
  classifyConnectEndpoint,
  publicConnectStatus,
  recruiterConnectView,
  sourceWithOptionalRsc,
  tokenChannelView,
} from "../src/lib/linkedin-rsc";

const TOKEN = "synthetic-rsc-bearer";
const VENDOR_KEY = "synthetic-vendor-key";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

ok("unset RSC is not connected", recruiterConnectView({}).connected === false);
ok("unset RSC reason is not-configured", recruiterConnectView({}).reason === "not-configured");
ok("token without URL stays not connected", recruiterConnectView({ LINKEDIN_RSC_TOKEN: TOKEN }).connected === false);

ok(
  "http remote endpoint is refused",
  classifyConnectEndpoint("http://rsc.example.test/search").ok === false &&
    recruiterConnectView({ LINKEDIN_RSC_URL: "http://rsc.example.test/search", LINKEDIN_RSC_TOKEN: TOKEN }).reason ===
      "refused-insecure",
);
for (const pageUrl of [
  "https://www.linkedin.com/in/synthetic-profile",
  "https://linkedin.com/recruiter",
  "http://linkedin.com/feed",
  "https://api.linkedin.com/v2/people",
]) {
  const view = recruiterConnectView({ LINKEDIN_RSC_URL: pageUrl, LINKEDIN_RSC_TOKEN: TOKEN });
  ok(`refuses linkedin.com page ${pageUrl}`, view.connected === false && view.reason === "refused-page-url" && view.endpointHost === null);
}

const connected = publicConnectStatus({
  LINKEDIN_RSC_URL: "https://rsc.example.test/v1/search",
  LINKEDIN_RSC_TOKEN: TOKEN,
});
ok("https endpoint with bearer is connected", connected.recruiterSystemConnect.connected === true);
ok("public status shows the host only", connected.recruiterSystemConnect.endpointHost === "rsc.example.test");
ok("public status does not echo the token", !JSON.stringify(connected).includes(TOKEN));
ok("public status does not echo the path", !JSON.stringify(connected).includes("/v1/search"));
ok(
  "token embedded in the URL is refused",
  recruiterConnectView({
    LINKEDIN_RSC_URL: `https://rsc.example.test/search?access=${TOKEN}`,
    LINKEDIN_RSC_TOKEN: TOKEN,
  }).connected === false,
);

ok("token channel is off by default", tokenChannelView({}).reason === "off-by-default" && tokenChannelView({}).connected === false);
ok(
  "token channel refuses a linkedin.com URL",
  tokenChannelView({ LINKEDIN_VENDOR_API_URL: "https://www.linkedin.com/messaging", LINKEDIN_VENDOR_API_KEY: VENDOR_KEY }).reason ===
    "refused-page-url",
);
const vendor = publicConnectStatus({
  LINKEDIN_VENDOR_API_URL: "https://vendor.example.test/send",
  LINKEDIN_VENDOR_API_KEY: VENDOR_KEY,
});
ok("token channel can be connected from server env", vendor.tokenChannel.connected === true);
ok("token channel host only", vendor.tokenChannel.endpointHost === "vendor.example.test");
ok("token channel does not echo the key", !JSON.stringify(vendor).includes(VENDOR_KEY));
ok("exact-text approval stays required", vendor.tokenChannel.exactTextApproval === true && LINKEDIN_TOKEN_CHANNEL_EXACT_TEXT_APPROVAL === true);

const migration = readFileSync("supabase/migrations/0054_linkedin_channel_adapter_authority.sql", "utf8");
ok(
  "existing claim still hashes the exact subject and body",
  /approval\.body_hash is distinct from encode\(digest\(coalesce\(outbound\.subject, ''\) \|\| E'\\n' \|\| outbound\.body, 'sha256'\), 'hex'\)/.test(migration),
);

const panel = readFileSync("src/components/settings/linkedin-connect-panel.tsx", "utf8");
const card = readFileSync("src/components/settings/integration-card.tsx", "utf8");
ok("panel does not read the RSC token from the environment", !panel.includes("process.env.LINKEDIN_RSC_TOKEN"));
ok("panel does not read the vendor key from the environment", !panel.includes("process.env.LINKEDIN_VENDOR_API_KEY"));
ok("RSC card does not open the credential form", card.includes('integration.id === "int_linkedin_rsc"') && card.includes("This screen does not store a token."));

const dropped = applyRscQualityBar({
  results: [
    { name: "No Location", role: "Engineer", location: "", text: "Engineer", skills: [] },
    { name: "No Signal", role: "", location: "Lyon", text: "Just a bio.", skills: ["Ghost"] },
  ],
});
ok("quality bar drops empty profiles", dropped.length === 0);

let fetches = 0;
const disconnected = await sourceWithOptionalRsc({
  query: "staff engineer paris",
  count: 5,
  env: {},
  fetchImpl: async () => {
    fetches += 1;
    throw new Error("should not fetch");
  },
});
ok("disconnected sourcing does not call LinkedIn", fetches === 0 && disconnected.linkedIn === false && disconnected.ok === true);
ok(
  "disconnected sourcing still returns workspace candidates",
  disconnected.candidates.length === SYNTHETIC_WORKSPACE_CANDIDATES.length &&
    disconnected.candidates.some((candidate) => candidate.name === "Mina Local"),
);

const refused = await sourceWithOptionalRsc({
  query: "staff engineer paris",
  count: 5,
  env: { LINKEDIN_RSC_URL: "https://www.linkedin.com/in/synthetic-profile", LINKEDIN_RSC_TOKEN: TOKEN },
  fetchImpl: async () => {
    fetches += 1;
    throw new Error("should not fetch a linkedin.com page");
  },
});
ok("refused page URL does not fetch", fetches === 0 && refused.recruiter === "refused" && refused.linkedIn === false);
ok("refused page URL still returns workspace candidates", refused.candidates.some((candidate) => candidate.name === "Leo Local"));

const hits: { method: string; authorization: string; body: string }[] = [];
const stub = createServer(async (req, res) => {
  const body = await readBody(req);
  hits.push({
    method: req.method ?? "",
    authorization: req.headers.authorization ?? "",
    body,
  });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      results: [
        {
          name: "Ada Synthetic",
          role: "Staff Engineer",
          location: "Paris",
          text: "Staff engineer in Paris. Skills: TypeScript, React.",
          skills: ["TypeScript", "React", "NotInText"],
        },
        { name: "No Signal", role: "", location: "Lyon", text: "Just a bio.", skills: ["Ghost"] },
        { name: "Skill Only", role: "", location: "Lyon", text: "Known for GraphQL.", skills: ["GraphQL"] },
      ],
    }),
  );
});
stub.listen(0, "127.0.0.1");
await once(stub, "listening");
const address = stub.address();
if (!address || typeof address === "string") throw new Error("stub failed to bind");
const stubUrl = `http://127.0.0.1:${address.port}/rsc`;

for (let run = 0; run < 2; run++) {
  const sourced = await sourceWithOptionalRsc({
    query: "staff engineer paris",
    count: 5,
    env: { LINKEDIN_RSC_URL: stubUrl, LINKEDIN_RSC_TOKEN: TOKEN },
  });
  const ada = sourced.candidates.find((candidate) => candidate.name === "Ada Synthetic");
  const skillOnly = sourced.candidates.find((candidate) => candidate.name === "Skill Only");
  ok(`stub run ${run + 1} keeps workspace candidates`, sourced.candidates.some((candidate) => candidate.name === "Mina Local"));
  ok(`stub run ${run + 1} returns RSC results`, sourced.linkedIn === true && sourced.recruiter === "connected");
  ok(
    `stub run ${run + 1} applies the quality bar`,
    ada?.source === LINKEDIN_RSC_SOURCE &&
      ada.skills.includes("TypeScript") &&
      !ada.skills.includes("NotInText") &&
      skillOnly?.source === LINKEDIN_RSC_SOURCE &&
      skillOnly.skills.includes("GraphQL") &&
      !sourced.candidates.some((candidate) => candidate.name === "No Signal"),
  );
}

ok("stub was called twice", hits.length === 2);
ok(
  "stub saw the official RSC POST",
  hits.every((hit) => {
    const parsed = JSON.parse(hit.body) as { source?: string; query?: string; count?: number };
    return (
      hit.method === "POST" &&
      hit.authorization === `Bearer ${TOKEN}` &&
      parsed.source === LINKEDIN_RSC_SOURCE &&
      parsed.query === "staff engineer paris" &&
      parsed.count === 5 &&
      !hit.body.includes("cookie")
    );
  }),
);

await new Promise<void>((resolve, reject) => stub.close((error) => (error ? reject(error) : resolve())));

console.log(`RESULT linkedin-rsc-connect: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
