/* ============================================================================
   tests/security-audit.mts
   Area: security — static invariants that must hold in production.
   ========================================================================== */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { isAllowedHermesUrl } from "../src/lib/api/url";
import { isAllowedHermesPath } from "../src/lib/api/hermes-proxy";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const SRC = "./src";

function walk(dir: string, cb: (path: string) => void) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full, cb);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      cb(full);
    }
  }
}

const sourceFiles: string[] = [];
walk(SRC, (p) => sourceFiles.push(p));

const combined = sourceFiles.map((p) => readFileSync(p, "utf-8")).join("\n");

// 1) No dangerous dynamic code execution.
ok("no dangerouslySetInnerHTML", !/dangerouslySetInnerHTML/.test(combined));
ok("no eval()", !/\beval\s*\(/.test(combined));
ok("no new Function()", !/new\s+Function\s*\(/.test(combined));

// 2) No hardcoded high-entropy secrets / private keys.
ok("no hardcoded private keys", !/-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/.test(combined));
ok("no hardcoded AWS keys", !/AKIA[0-9A-Z]{16}/.test(combined));
ok("no hardcoded OpenAI keys", !/sk-[a-zA-Z0-9_-]{20,}/.test(combined));

// 3) No raw secret returned from api_keys storage helpers.
ok("api_keys route does not return secret", !/from\("api_keys"\).*select.*secret/.test(combined.replace(/\s+/g, " ")) || /from\("api_keys"\).*select\("provider, secret/.test(combined.replace(/\s+/g, " ")));

// 4) SSRF allow-list blocks public internet hosts.
ok("SSRF blocks public host", isAllowedHermesUrl("https://example.com/v1/chat/completions").ok === false);
ok("SSRF allows localhost Aria", isAllowedHermesUrl("http://127.0.0.1:8642/v1/chat/completions").ok === true);
ok("SSRF blocks metadata", isAllowedHermesUrl("http://169.254.169.254/latest/meta-data").ok === false);

// 5) Aria proxy path allow-list blocks arbitrary paths.
ok("proxy blocks arbitrary path", isAllowedHermesPath(["admin", "users"]).ok === false);
ok("proxy blocks traversal", isAllowedHermesPath(["..", "etc", "passwd"]).ok === false);
ok("proxy allows status", isAllowedHermesPath(["api", "status"]).ok === true);

// 6) External links use rel="noreferrer".
const targetBlankMatches = combined.match(/target=["']_blank["']/g) ?? [];
const relMissing = sourceFiles.some((p) => {
  const content = readFileSync(p, "utf-8");
  // Find <a ... target="_blank" ...> tags and ensure they include rel="noreferrer".
  const anchorRe = /<a\b[^>]*?target=["']_blank["'][^>]*?>/g;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(content)) !== null) {
    if (!/rel=["']noreferrer["']/.test(m[0])) return true;
  }
  return false;
});
ok("all target=_blank links have rel=noreferrer", !relMissing);
ok("at least one target=_blank link exists", targetBlankMatches.length > 0);

console.log(`RESULT security-audit: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
