/**
 * L-01: the compose HMAC secret is an environment reference with no default.
 * Synthetic values only. The sample literal is not copied into this test.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const jwtLine = compose.split("\n").find((line) => line.includes("jwt_secret:")) ?? "";
ok(
  "jwt secret is an env reference with no default",
  /jwt_secret:\s*&jwt_secret\s+\$\{SUPABASE_JWT_SECRET:\?[^}]+\}/.test(jwtLine) && !jwtLine.includes(":-") && !jwtLine.includes('"'),
);

function jwtSecretAcceptable(secret: string): boolean {
  if (Buffer.byteLength(secret) < 32) return false;
  if (/\s/.test(secret)) return false;
  return true;
}

ok("a generated 32-byte value passes", jwtSecretAcceptable(randomBytes(32).toString("base64url")));
ok("a short value is refused", jwtSecretAcceptable("short-synthetic") === false);

const gitleaks = readFileSync(new URL("../.gitleaks.toml", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
ok("gitleaks config keeps the default rules", gitleaks.includes("useDefault = true"));
ok(
  "gitleaks flags a quoted compose jwt secret",
  gitleaks.includes('id = "aria-compose-jwt-literal"'),
);
ok(
  "CI runs gitleaks with the repo config",
  workflow.includes("gitleaks git") && workflow.includes("--config .gitleaks.toml"),
);

console.log(`RESULT compose-jwt-reference: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
