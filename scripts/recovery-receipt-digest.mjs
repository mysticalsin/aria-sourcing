#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const [path] = process.argv.slice(2);
if (!path || process.argv.length !== 3) {
  process.stderr.write("Usage: recovery-receipt-digest.mjs <receipt.json>\n");
  process.exit(1);
}

let stats;
try {
  stats = statSync(path);
} catch {
  process.stderr.write("Recovery receipt is missing.\n");
  process.exit(1);
}
if (!stats.isFile() || stats.size < 2 || stats.size > 65_536) {
  process.stderr.write("Recovery receipt has an invalid size or type.\n");
  process.exit(1);
}

let document;
try {
  document = JSON.parse(readFileSync(path, "utf8"));
} catch {
  process.stderr.write("Recovery receipt is not valid JSON.\n");
  process.exit(1);
}
if (!document || typeof document !== "object" || Array.isArray(document)) {
  process.stderr.write("Recovery receipt root must be an object.\n");
  process.exit(1);
}

const canonical = `${JSON.stringify(document)}\n`;
process.stdout.write(`${createHash("sha256").update(canonical).digest("hex")}\n`);
