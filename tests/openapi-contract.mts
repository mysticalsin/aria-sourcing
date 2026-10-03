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
  "/api/admin/source/apollo/erasure",
  "/api/admin/source/apollo/reconciliation",
  "/api/agents/memories",
  "/api/source/apollo/enrich",
  "/api/source/apollo/search",
  "/api/source/apollo/select",
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

const memoryPath = paths["/api/agents/memories"] as Record<string, unknown>;
const memoryGet = memoryPath.get as {
  parameters?: Array<{ name?: string; required?: boolean; schema?: Record<string, unknown> }>;
};
const memoryGetParameters = Object.fromEntries(
  (memoryGet.parameters ?? []).map((parameter) => [parameter.name, parameter]),
);
assert.deepEqual(Object.keys(memoryGetParameters).sort(), ["cursor", "limit", "specCursor", "specId"]);
assert.equal(memoryGetParameters.specId?.required, false);
assert.deepEqual(memoryGetParameters.limit?.schema, {
  type: "integer",
  minimum: 1,
  maximum: 100,
  default: 25,
});
assert.equal(memoryGetParameters.cursor?.schema?.type, "string");
assert.equal(memoryGetParameters.cursor?.schema?.maxLength, 512);
assert.equal(memoryGetParameters.specCursor?.schema?.type, "string");
assert.equal(memoryGetParameters.specCursor?.schema?.maxLength, 512);

const schemas = (document.components as Record<string, unknown>).schemas as Record<string, unknown>;
const memoryListResponse = schemas.AgentMemoryListResponse as {
  required?: string[];
  properties?: Record<string, unknown>;
};
assert.deepEqual(
  [...(memoryListResponse.required ?? [])].sort(),
  ["bounds", "memories", "nextCursor", "nextSpecCursor", "ok", "requestId", "specs"],
);
const nextSpecCursor = memoryListResponse.properties?.nextSpecCursor as {
  oneOf?: Array<Record<string, unknown>>;
};
assert.ok(nextSpecCursor.oneOf?.some((branch) => branch.type === "string"));
assert.ok(nextSpecCursor.oneOf?.some((branch) => branch.type === "null"));
const memoryListBounds = schemas.AgentMemoryListBounds as { required?: string[] };
assert.deepEqual(
  [...(memoryListBounds.required ?? [])].sort(),
  ["specLimit", "specsTruncated"],
);
for (const method of ["post", "patch", "delete"]) {
  const operation = memoryPath[method] as { responses?: Record<string, unknown> };
  assert.deepEqual(
    operation.responses?.["415"],
    { $ref: "#/components/responses/AgentMemoryErrorResponse" },
    `${method.toUpperCase()} /api/agents/memories must document its non-JSON response`,
  );
}
const memoryError = schemas.AgentMemoryError as {
  properties?: { code?: { enum?: string[] } };
};
assert.ok(memoryError.properties?.code?.enum?.includes("memory_in_use"));

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
