/**
 * Locks the absence of the legacy LinkedIn bridge: no extension, no Voyager
 * client, no session cookie, and no live profile scrape script.
 * Stored profile URLs and the policy denylist are not automation.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BANNED_PATHS = [
  "extensions/linkedin-bridge",
  "src/app/api/linkedin/bridge",
  "src/app/api/linkedin/outbox/route.ts",
  "src/app/linkedin/page.tsx",
  "src/components/linkedin/use-bridge-extension.ts",
  "src/lib/ai/voyager.ts",
  "scripts/smoke-linkedin-live.mts",
];
const BANNED_TEXT = [/li_at/, /JSESSIONID/, /\/voyager\//i, /linkedin\.com\/voyager/i];
const SCAN_ROOTS = ["src", "scripts", "extensions", "services", "core"];

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL ${label}`);
  }
}

for (const relative of BANNED_PATHS) {
  check(`absent ${relative}`, !existsSync(path.join(ROOT, relative)));
}

function walk(dir: string, hits: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "target") continue;
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, hits);
    else if (/\.(ts|tsx|js|mjs|mts|go|rs)$/.test(entry)) hits.push(full);
  }
}

const files: string[] = [];
for (const root of SCAN_ROOTS) walk(path.join(ROOT, root), files);
const offenders: string[] = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const pattern of BANNED_TEXT) {
    if (pattern.test(text)) offenders.push(`${path.relative(ROOT, file)} ${pattern}`);
  }
}
check("no Voyager client, li_at, or JSESSIONID in product code", offenders.length === 0);
if (offenders.length > 0) console.error(offenders.slice(0, 20).join("\n"));

console.log(`RESULT legacy-linkedin-automation: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
