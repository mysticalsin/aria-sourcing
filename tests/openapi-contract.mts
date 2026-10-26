import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load: (source: string) => unknown };
const document = yaml.load(
  readFileSync(new URL("../docs/api/openapi.yaml", import.meta.url), "utf8"),
) as Record<string, unknown>;

assert.equal(document.openapi, "3.1.0");
const paths = document.paths as Record<string, unknown>;
assert.deepEqual(Object.keys(paths).sort(), [
  "/api/admin/candidates/erasure",
]);

const references: string[] = [];
function collect(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(collect);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$ref" && typeof child === "string") references.push(child);
    collect(child);
  }
}
collect(document);

for (const reference of references) {
  assert.match(reference, /^#\//, `external OpenAPI reference is not allowed: ${reference}`);
  let resolved: unknown = document;
  for (const rawPart of reference.slice(2).split("/")) {
    const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
    assert.ok(
      resolved && typeof resolved === "object" && part in (resolved as Record<string, unknown>),
      `unresolved OpenAPI reference: ${reference}`,
    );
    resolved = (resolved as Record<string, unknown>)[part];
  }
}

const schemas = (document.components as Record<string, unknown>).schemas as Record<string, unknown>;

const candidateErasurePath = paths["/api/admin/candidates/erasure"] as Record<string, unknown>;
assert.deepEqual(Object.keys(candidateErasurePath).sort(), ["patch", "post"]);
const erasurePatch = candidateErasurePath.patch as {
  requestBody?: { content?: { "application/json"?: { schema?: { $ref?: string } } } };
  responses?: Record<string, unknown>;
};
assert.equal(
  erasurePatch.requestBody?.content?.["application/json"]?.schema?.$ref,
  "#/components/schemas/CandidateErasureObligationAction",
);
assert.ok(erasurePatch.responses?.["202"]);
assert.ok(erasurePatch.responses?.["409"]);
assert.ok(erasurePatch.responses?.["423"]);
const erasureActions = schemas.CandidateErasureObligationAction as {
  oneOf?: Array<{ properties?: { action?: { const?: string } } }>;
};
assert.ok(erasureActions.oneOf?.some((branch) => branch.properties?.action?.const === "list"));
const erasureObligation = schemas.CandidateErasureObligation as { required?: string[] };
assert.ok(erasureObligation.required?.includes("id"));
const erasureResponse = schemas.CandidateErasureResponse as {
  properties?: { status?: { enum?: string[] } };
};
assert.ok(!erasureResponse.properties?.status?.enum?.includes("blocked_legal_hold"));
const erasureQueueItem = schemas.CandidateErasureQueueItem as {
  properties?: { status?: { enum?: string[] } };
};
assert.ok(erasureQueueItem.properties?.status?.enum?.includes("blocked_legal_hold"));
const erasureQueueResponse = schemas.CandidateErasureQueueResponse as {
  properties?: { requests?: { items?: { $ref?: string } } };
};
assert.equal(
  erasureQueueResponse.properties?.requests?.items?.$ref,
  "#/components/schemas/CandidateErasureQueueItem",
);
const erasureAuthority = schemas.CandidateErasureAuthorityResponse as { required?: string[] };
assert.ok(erasureAuthority.required?.includes("reference"));

console.log(`RESULT openapi-contract: routes=${Object.keys(paths).length} refs=${references.length}`);
