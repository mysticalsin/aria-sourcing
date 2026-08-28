import { readFileSync } from "node:fs";

import { detectLanguageWithHint } from "../src/lib/i18n";

const expected = (process.argv[2] ?? "en").trim().slice(0, 2);
const textPath = process.argv[3];
const text = textPath ? readFileSync(textPath, "utf8") : "";

if (!text.trim()) {
  console.error("assert-outreach-language: empty text");
  process.exit(2);
}

const detected = detectLanguageWithHint(text, expected);
if (detected !== expected) {
  console.error(`assert-outreach-language: expected ${expected}, detected ${detected}`);
  process.exit(1);
}

console.log(`assert-outreach-language: ok (${expected})`);
