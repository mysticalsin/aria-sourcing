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
  "/api/admin/source/apollo/erasure",
  "/api/admin/source/apollo/reconciliation",
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

console.log(`RESULT openapi-contract: routes=${Object.keys(paths).length} refs=${references.length}`);
