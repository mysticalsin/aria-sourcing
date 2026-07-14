import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateSecretFiles } from "./secret-preflight.mjs";

test("secret preflight rejects empty, short, malformed, and reused authorities", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aria-secret-preflight-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, value, { mode: 0o600 });
    return file;
  };
  const first = write("first", "A".repeat(32));
  const second = write("second", "B".repeat(32));
  assert.equal(validateSecretFiles([first, second]), true);
  assert.throws(() => validateSecretFiles([write("empty", ""), second]), /empty, short/);
  assert.throws(() => validateSecretFiles([write("short", "C".repeat(31)), second]), /empty, short/);
  assert.throws(() => validateSecretFiles([write("malformed", `${"D".repeat(32)}!`), second]), /not base64url/);
  assert.throws(() => validateSecretFiles([first, write("reuse", "A".repeat(32))]), /must not be reused/);
});
