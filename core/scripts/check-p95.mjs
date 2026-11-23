/**
 * Fail when a measured p95 is more than 10% slower than the previous accepted
 * sample. The first sample is stored and does not fail.
 *
 *   node core/scripts/check-p95.mjs --history core/bench/ci-history/previous.json --current core/bench/current.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const LIMIT = 1.1;

export function evaluateP95Gate(previous, current, limit = LIMIT) {
  if (!Array.isArray(current) || current.length === 0) {
    throw new Error("current benchmark file must be a non-empty array");
  }
  const failures = [];
  if (!Array.isArray(previous)) return failures;
  const prior = new Map(previous.map((row) => [row.name, row.value]));
  for (const row of current) {
    const before = prior.get(row.name);
    if (typeof before !== "number" || before <= 0) continue;
    const ratio = row.value / before;
    if (ratio > limit) {
      failures.push(
        `${row.name}: ${row.value}${row.unit} is ${(ratio * 100).toFixed(1)}% of the previous ${before}${row.unit} (limit 110%)`,
      );
    }
  }
  return failures;
}

function invokedDirectly() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

function main() {
  const args = process.argv.slice(2);
  function arg(name) {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`missing ${name}`);
    return args[index + 1];
  }
  const historyPath = arg("--history");
  const currentPath = arg("--current");
  const current = JSON.parse(readFileSync(currentPath, "utf8"));
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(historyPath, "utf8"));
  } catch {
    previous = null;
  }
  const failures = evaluateP95Gate(previous, current);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  mkdirSync(dirname(historyPath), { recursive: true });
  writeFileSync(historyPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(
    `p95 within 10% of the previous CI sample (${current.map((row) => `${row.name}=${row.value}${row.unit}`).join(", ")})`,
  );
}

if (invokedDirectly()) main();
