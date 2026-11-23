import { fetchPublicUrl } from "../src/lib/api/public-fetch.ts";
import type { PublicFetchTransport, PublicResolver } from "../src/lib/api/public-fetch.ts";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const publicResolver: PublicResolver = async () => [{ address: "1.1.1.1", family: 4 }];
const privateResolver: PublicResolver = async () => [{ address: "10.1.2.3", family: 4 }];

let pinned: string | undefined;
let redirect: RequestRedirect | undefined | null;
let calls = 0;
const transport: PublicFetchTransport = async (request) => {
  calls += 1;
  pinned = request.address.address;
  redirect = request.init.redirect;
  return new Response(null, { status: 302, headers: { location: "https://evil.example.test/redirect" } });
};

const redirected = await fetchPublicUrl(
  "https://hire-api.example.test/v1/hire/hr.job",
  { method: "POST", body: "{}" },
  { resolver: publicResolver, transport },
);
ok("default transport connects to the resolved public address", pinned === "1.1.1.1" && calls === 1);
ok("default transport does not follow a redirect", redirected.status === 302 && redirect === "manual" && calls === 1);

let privateCalls = 0;
let privateError = "";
try {
  await fetchPublicUrl(
    "https://hire-api.example.test/v1/hire/hr.job",
    { method: "POST", body: "{}" },
    {
      resolver: privateResolver,
      transport: async () => {
        privateCalls += 1;
        return new Response("no");
      },
    },
  );
} catch (err) {
  privateError = err instanceof Error ? err.message : "";
}
ok("default transport refuses a private DNS answer before connecting", privateCalls === 0 && /private|non-public/i.test(privateError));

let credentialCalls = 0;
let credentialError = "";
try {
  await fetchPublicUrl(
    "https://user:secret@hire-api.example.test/v1/hire/hr.job",
    { method: "POST", body: "{}" },
    {
      resolver: publicResolver,
      transport: async () => {
        credentialCalls += 1;
        return new Response("no");
      },
    },
  );
} catch (err) {
  credentialError = err instanceof Error ? err.message : "";
}
ok("default transport refuses credentials embedded in the URL", credentialCalls === 0 && /credential/i.test(credentialError));

console.log(`RESULT public-fetch-pin: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
