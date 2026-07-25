/* ============================================================================
   tests/swarm-request-boundary.mts
   Area: /api/swarm mutation request boundary.

   The swarm POST handlers reached validateBody directly. validateBody checks
   size and schema and has nothing to say about origin or media type, so a
   cross-site form post carrying the caller's cookies could answer an
   escalation, create a mission, or change the agent roster. Every other
   hardened mutation route in this repo classifies the request first.

   This is also the first test the swarm plane has ever had. The structural
   half matters as much as the behavioural half: it fails when a NEW swarm
   mutation route is added without the guard, so the class of defect cannot be
   reintroduced by someone who has never read this file.
   ========================================================================== */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { swarmRequestBoundary } from "../src/lib/api/swarm-request-boundary";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- behaviour ---------------------------------------------------------- */

const ORIGIN = "https://aria.example.com";
function request(headers: Record<string, string>) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    nextUrl: { origin: ORIGIN },
  } as unknown as Parameters<typeof swarmRequestBoundary>[0];
}

const accepted = swarmRequestBoundary(request({ "content-type": "application/json", origin: ORIGIN }));
ok("a same-origin JSON mutation is allowed through", accepted === null);

const withCharset = swarmRequestBoundary(
  request({ "content-type": "application/json; charset=utf-8", origin: ORIGIN }),
);
ok("a charset parameter does not change the media type verdict", withCharset === null);

const crossOrigin = swarmRequestBoundary(
  request({ "content-type": "application/json", origin: "https://evil.example.com" }),
);
ok("a cross-origin JSON mutation is refused with 403", crossOrigin !== null && crossOrigin.status === 403);

const noOrigin = swarmRequestBoundary(request({ "content-type": "application/json" }));
ok("a missing Origin header is refused, not treated as same-origin", noOrigin !== null && noOrigin.status === 403);

// The media-type check is what stops a simple cross-site HTML form: forms can
// only send urlencoded, multipart or text/plain, none of which are JSON.
for (const contentType of [
  "application/x-www-form-urlencoded",
  "multipart/form-data; boundary=x",
  "text/plain",
  "application/json+evil",
  "",
]) {
  const refused = swarmRequestBoundary(request({ "content-type": contentType, origin: ORIGIN }));
  ok(
    `a ${contentType || "(absent)"} body is refused with 415`,
    refused !== null && refused.status === 415,
  );
}
const noContentType = swarmRequestBoundary(request({ origin: ORIGIN }));
ok("an absent Content-Type is refused with 415", noContentType !== null && noContentType.status === 415);

/* ---- structure: no swarm mutation may skip the boundary ------------------ */

const swarmRoutes = readdirSync("src/app/api/swarm", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join("src/app/api/swarm", entry.name, "route.ts"));

ok("the swarm route directory was found", swarmRoutes.length >= 4);

const MUTATION_EXPORTS = ["POST", "PUT", "PATCH", "DELETE"] as const;
let checkedMutations = 0;

for (const routePath of swarmRoutes) {
  const source = readFileSync(routePath, "utf8");
  for (const method of MUTATION_EXPORTS) {
    const handlerIndex = source.indexOf(`export async function ${method}(`);
    if (handlerIndex < 0) continue;
    checkedMutations++;
    // The guard must appear inside the handler, and before anything that
    // authenticates, parses or mutates. Comparing indices is deliberate: a
    // guard placed after a session lookup would already have done the work the
    // guard exists to prevent.
    const body = source.slice(handlerIndex);
    const guardIndex = body.indexOf("swarmRequestBoundary(req)");
    const sessionIndex = body.indexOf("getServerSupabase(");
    const parseIndex = body.indexOf("validateBody(");
    ok(`${routePath} ${method} calls the request boundary`, guardIndex > 0);
    ok(
      `${routePath} ${method} calls the boundary before authenticating`,
      guardIndex > 0 && (sessionIndex < 0 || guardIndex < sessionIndex),
    );
    ok(
      `${routePath} ${method} calls the boundary before parsing the body`,
      guardIndex > 0 && (parseIndex < 0 || guardIndex < parseIndex),
    );
  }
}

ok("every swarm mutation handler was checked", checkedMutations >= 3);

// The helper must stay a single shared implementation. A second private copy is
// how the Hermes bearer resolver drifted into two different security postures.
const boundarySource = readFileSync("src/lib/api/swarm-request-boundary.ts", "utf8");
ok(
  "the boundary delegates to the shared same-origin classifier",
  boundarySource.includes("classifySameOriginJsonRequest"),
);
ok(
  "the boundary fails closed on an unrecognised verdict",
  /return boundary === "unsupported_media_type"/.test(boundarySource) && boundarySource.includes("403"),
);

console.log(`RESULT swarm-request-boundary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
