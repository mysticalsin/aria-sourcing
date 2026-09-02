/**
 * White-label guard (docs/outreach/ARIA-LINKEDIN-CONNECT.md, section 2.4 and S2).
 *
 * The operator sees Aria and LinkedIn, never the delivery vendor. Every file
 * under src/components and src/app, plus the two copy-bearing libs, must be
 * free of vendor names and of "Vendor API" outside comments. Em dashes are
 * banned in operator-facing prose; a bare "—" used as an empty-value
 * placeholder is not prose and is allowed.
 *
 * The adapter provider string "LinkedIn Vendor API" and the send-key provider
 * ids are DB values; they live in src/lib/linkedin-channel.ts and migrations
 * only, and components import the named constants instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const SCOPE = [...walk("src/components"), ...walk("src/app"), "src/lib/sourcing/people-connect.ts", "src/lib/integrations.ts"].sort();

// Comment-free source: block comments (JSX comment bodies included) and line comments removed.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s(,;{])\/\/.*$/gm, "$1");
}

const VENDOR_TOKENS: { name: string; re: RegExp }[] = [
  { name: "HeyReach", re: /heyreach/i },
  { name: "Unipile", re: /unipile/i },
  { name: "PhantomBuster", re: /phantombuster/i },
  { name: "Dux-Soup", re: /dux-?soup/i },
  { name: "vendor campaign", re: /vendor campaign/i },
  { name: "Vendor API", re: /Vendor API/ },
];

const violations: string[] = [];
let emDashViolations = 0;

for (const file of SCOPE) {
  const source = stripComments(readFileSync(file, "utf8"));
  for (const token of VENDOR_TOKENS) {
    if (token.re.test(source)) violations.push(`${file}: ${token.name}`);
  }
  source.split("\n").forEach((line, index) => {
    if (!line.includes("—")) return;
    // A bare placeholder ("—", '—', `—`, >—<) is not prose.
    const prose = line
      .replace(/(["'`])—\1/g, "")
      .replace(/>\s*—\s*</g, "")
      .replace(/^\s*—\s*$/g, "");
    if (prose.includes("—")) {
      emDashViolations++;
      violations.push(`${file}:${index + 1}: em dash in operator-facing text`);
    }
  });
}

ok(`scope covers the LinkedIn surface (${SCOPE.length} files)`, SCOPE.length > 50 && SCOPE.some((f) => f.endsWith("linkedin-loop-panel.tsx")));
ok("no vendor name or 'Vendor API' in operator-facing files", violations.filter((v) => !/em dash/.test(v)).length === 0);
ok("no em dash in operator-facing prose", emDashViolations === 0);
for (const v of violations) console.log("  violation:", v);

// The internal literals live in exactly the places the plan allows.
const channel = readFileSync("src/lib/linkedin-channel.ts", "utf8");
ok(
  "internal provider ids are defined once in linkedin-channel.ts",
  /export const LINKEDIN_VENDOR_PROVIDER = "LinkedIn Vendor API"/.test(channel) &&
    /export const LINKEDIN_SEND_INTEGRATION_ID = /.test(channel) &&
    /export const LINKEDIN_SEND_KEY_PROVIDERS/.test(channel),
);
ok("the operator label for the delivery seat is LinkedIn", /return provider === LINKEDIN_VENDOR_PROVIDER \? "LinkedIn" : provider;/.test(channel));

// The card and the copy named in the plan.
const seatCard = readFileSync("src/components/fleet/seat-card.tsx", "utf8");
ok("seat card button is Connect LinkedIn", /"Connect LinkedIn"/.test(seatCard) && /seatProviderLabel\(seat\.provider\)/.test(seatCard));
const panel = stripComments(readFileSync("src/components/settings/linkedin-loop-panel.tsx", "utf8"));
ok("settings panel is titled LinkedIn sending", /LinkedIn sending/.test(panel));
ok(
  "settings panel kill switch copy",
  /Stop everything\. Every queued message becomes a draft for a person\./.test(panel),
);
ok("settings panel never says vendor", !/vendor/i.test(panel.replace(/vendor_campaign_id/g, "")));
const quickDraft = readFileSync("src/components/outreach/quick-draft.tsx", "utf8");
ok("quick draft points at Connect LinkedIn, not a console", /linkedin-sender/.test(quickDraft) && /Connect LinkedIn in Fleet/.test(quickDraft));
const integrations = readFileSync("src/lib/integrations.ts", "utf8");
ok("integration card is named LinkedIn sending", /name: "LinkedIn sending"/.test(integrations));
const peopleConnect = readFileSync("src/lib/sourcing/people-connect.ts", "utf8");
ok("send blocker points at Connect LinkedIn", /"Connect LinkedIn in Fleet before confirming a send\. Approval alone never sends\."/.test(peopleConnect));

// Never identify as AI in operator chrome for LinkedIn (gateOutbound covers candidate text).
ok(
  "LinkedIn sending panel never calls itself AI, a bot or automation",
  !/\b(AI|assistant|automation|bot|model)\b/.test(panel.replace(/Automatic LinkedIn replies/g, "")),
);

console.log(`RESULT linkedin-white-label: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
