/**
 * Compliance boundaries (twa-odoo PR 1).
 *
 * These tests fail while a banned path is present and fail again if it
 * reappears. They scan executable source only (src, extensions, scripts,
 * env examples). Historical migrations 0006–0008 stay immutable; a later
 * migration must drop what they created. Docs, relay notes and tests are
 * not scanned: a profile URL string is not a call to linkedin.com.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = process.cwd();

const BANNED_SURFACES = [
  "extensions/linkedin-bridge",
  "src/lib/linkedin-bridge",
  "src/app/api/linkedin",
  "src/app/linkedin",
  "src/components/linkedin",
  "src/lib/agents/autopilot.ts",
  "src/lib/agents/campaign-mission.ts",
  "src/lib/agents/tick.ts",
  "src/lib/agents/server/deps.ts",
  "src/lib/sourcing/claude-web-search.ts",
  "src/app/api/agent/autopilot/route.ts",
  "src/app/api/agent/tick/route.ts",
  "src/components/agents/campaign-autopilot-card.tsx",
  "scripts/smoke-linkedin-live.mts",
  "scripts/probe-tavily-mcp.mts",
] as const;

const BRIDGE_TABLES = [
  "linkedin_bridge_accounts",
  "linkedin_bridge_conversations",
  "linkedin_bridge_messages",
  "linkedin_bridge_outbox",
  "linkedin_bridge_contacts",
] as const;

const TOKEN_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "aria_lnb_ pairing prefix", pattern: /aria_lnb_/ },
  { label: "li_at session cookie", pattern: /\bli_at\b/ },
  { label: "JSESSIONID", pattern: /\bJSESSIONID\b/ },
  { label: "LINKEDIN_VENDOR_API_ env", pattern: /LINKEDIN_VENDOR_API_/ },
  { label: "LINKEDIN_BRIDGE_ env", pattern: /LINKEDIN_BRIDGE_/ },
  { label: "AGENTS_LINKEDIN_ALLOWLIST", pattern: /AGENTS_LINKEDIN_ALLOWLIST/ },
  { label: "Voyager API", pattern: /voyager\/api|linkedin\.com\/voyager|from ["'][^"']*\/voyager["']/ },
  { label: "bridge token mint", pattern: /generateBridgeToken|hashBridgeToken|bridgeTokenFromHeader/ },
  { label: "extension directory", pattern: /extensions\/linkedin-bridge/ },
  { label: "bridge library", pattern: /src\/lib\/linkedin-bridge/ },
  { label: "bridge API route", pattern: /src\/app\/api\/linkedin\// },
];

/** A request, extension permission, or search scope aimed at a linkedin.com host. Profile /in/ URLs are not calls. */
const EGRESS_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "search tool allowed_domains", pattern: /allowed_domains\s*:\s*\[[^\]]*linkedin\.com/i },
  { label: "site:linkedin.com query", pattern: /site:\s*linkedin\.com/i },
  { label: "extension host permission", pattern: /(?:host_permissions|matches)\s*:\s*\[[^\]]*linkedin\.com/i },
  { label: "Voyager or messaging URL", pattern: /https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/(?:voyager|messaging|search\/results|sales-api|checkpoint|uas)\b/i },
  { label: "linkedin.com internal path", pattern: /linkedin\.com\/(?:voyager|messaging|search\/results|sales-api|checkpoint|uas)\b/i },
  { label: "fetch() aimed at linkedin.com", pattern: /\bfetch\s*\([\s\S]{0,240}linkedin\.com/i },
  { label: "search-scope domain literal", pattern: /["']linkedin\.com\/in["']/ },
  { label: "protocol-relative linkedin host", pattern: /(?:^|["'`\s])\/\/(?:[\w.-]+\.)?linkedin\.com/im },
  { label: "linkedin.com/voyager", pattern: /linkedin\.com\/voyager/i },
  { label: "LinkedIn CDN host", pattern: /licdn\.com/i },
  { label: "split linkedin host", pattern: /['"]linked['"]\s*\+\s*['"]in\.com['"]/i },
  { label: "split licdn host", pattern: /['"]li['"]\s*\+\s*['"]cdn(?:\.com)?['"]/i },
];

const VENDOR_HOSTS = [
  "api.apify.com",
  "api.proxycurl.com",
  "nubela.co",
  "kaspr.io",
  "api.lusha.com",
  "lusha.com",
  "phantombuster.com",
  "wiza.co",
  "api.apollo.io",
  "seamless.ai",
  "api.hunter.io",
  "dropcontact.com",
  "skrapp.io",
  "peopledatalabs.com",
  "brightdata.com",
  "dux-soup.com",
  "expandi.io",
  "waalaxy.com",
  "contactout.com",
  "rocketreach.co",
  "snov.io",
] as const;

const VENDOR_MODULE = /(?:^|\/)(?:apify|proxycurl|kaspr|lusha|phantombuster|wiza|apollo|seamless|hunter|dropcontact|skrapp)\.[cm]?[jt]s$/i;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function walk(dir: string, extensions: RegExp): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((entry) => {
    const child = join(abs, entry);
    const rel = relative(root, child).replaceAll("\\", "/");
    const stats = statSync(child);
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") return [];
      return walk(rel, extensions);
    }
    return extensions.test(entry) ? [rel] : [];
  });
}

/** Drop real comments. A protocol-relative URL (`"//www.linkedin.com"`) is not a comment. */
export function stripComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock.replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "dist", "_relay", "_agent_state", ".scratch"]);

const IMMUTABLE_MIGRATIONS = new Set([
  "supabase/migrations/0006_linkedin_bridge.sql",
  "supabase/migrations/0007_linkedin_bridge_seen.sql",
  "supabase/migrations/0008_linkedin_bridge_candidates.sql",
  "supabase/migrations/0009_agents_runner.sql",
]);

function repoFiles(): string[] {
  const roots = ["src", "extensions", "scripts", "tests", "supabase", ".github", "docs"];
  const files = roots.flatMap((dir) => walk(dir, /.*/));
  for (const entry of existsSync(root) ? readdirSync(root) : []) {
    if (/^(?:next\.config\.mjs|Dockerfile.*|docker-compose.*\.ya?ml|\.env.*\.example)$/.test(entry)) files.push(entry);
  }
  return files.filter((file) => file !== "tests/compliance-boundaries.mts" && !IMMUTABLE_MIGRATIONS.has(file));
}

function executableFiles(): string[] {
  return repoFiles();
}

test("test_no_linkedin_extension_token_path", () => {
  const present = BANNED_SURFACES.filter((path) => existsSync(join(root, path)));
  assert.deepEqual(present, [], `banned surface still present:\n${present.join("\n")}`);

  const files = [...executableFiles(), ".env.local.example"].filter((path) => existsSync(join(root, path)));
  const hits: string[] = [];
  for (const file of files) {
    const raw = read(file);
    const source = `${raw}\n${stripComments(raw)}`;
    for (const { label, pattern } of TOKEN_PATTERNS) {
      if (pattern.test(source)) hits.push(`${file}: ${label}`);
    }
    if (/csrf-token/i.test(raw) && /voyager/i.test(raw)) hits.push(`${file}: csrf-token with voyager`);
  }
  assert.deepEqual(hits, [], `token or bridge path reappeared:\n${hits.join("\n")}`);

  const drops = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => /^\d+_.*\.sql$/.test(name) && name > "0008_")
    .map((name) => read(`supabase/migrations/${name}`))
    .join("\n");
  for (const table of BRIDGE_TABLES) {
    assert.match(drops, new RegExp(`drop table if exists public\\.${table}\\b`, "i"), `missing drop for ${table}`);
  }
  assert.match(drops, /drop function if exists public\.linkedin_bridge_candidate\s*\(\s*uuid\s*,\s*text\s*\)/i);
});

test("test_no_linkedin_dot_com_egress", () => {
  assert.equal(existsSync(join(root, "src/lib/sourcing/claude-web-search.ts")), false);
  const hits: string[] = [];
  for (const file of executableFiles()) {
    const raw = read(file);
    const source = `${raw}\n${stripComments(raw)}`;
    for (const { label, pattern } of EGRESS_PATTERNS) {
      if (pattern.test(source)) hits.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(hits, [], `code calls a linkedin.com host:\n${hits.join("\n")}`);
});

test("test_no_scraper_or_enrichment_vendor", () => {
  const registry = read("src/lib/enrichment/registry.ts");
  assert.match(registry, /ENRICHMENT_PROVIDERS(?:\s*:\s*EnrichmentProvider\[\])?\s*=\s*\[\s*\]/);

  const files = [
    ...walk("src", /\.(?:ts|tsx|js|mjs)$/),
    ...walk("extensions", /\.(?:ts|tsx|js|mjs|json)$/),
    ...walk("scripts", /\.(?:ts|tsx|js|mjs|mts)$/),
  ];
  const hits: string[] = [];
  for (const file of files) {
    if (VENDOR_MODULE.test(file)) hits.push(`${file}: vendor module`);
    const source = stripComments(read(file)).toLowerCase();
    for (const host of VENDOR_HOSTS) {
      if (source.includes(host)) hits.push(`${file}: ${host}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("test_no_heyreach_call_unless_flag_on_and_approval_present", () => {
  const files = executableFiles().filter((file) => /^(?:src|scripts|extensions)\//.test(file) && /heyreach/i.test(read(file)));
  const example = existsSync(join(root, ".env.local.example")) ? read(".env.local.example") : "";
  assert.doesNotMatch(example, /ARIA_HEYREACH_ENABLED\s*=\s*true/);
  for (const file of files) {
    const source = stripComments(read(file));
    assert.match(source, /ARIA_HEYREACH_ENABLED/, `${file} calls HeyReach without the flag`);
    assert.match(
      source,
      /process\.env\.ARIA_HEYREACH_ENABLED\s*===\s*["']true["']/,
      `${file} must treat the flag as default-off`,
    );
    assert.match(source, /approval/i, `${file} calls HeyReach without an approval check`);
    assert.match(source, /sha-?256|approvalId|approval_id|bodyHash|body_hash/i, `${file} approval is not bound to the message`);
  }
});

test("stripComments keeps a protocol-relative LinkedIn URL", () => {
  const sample = 'const host = "//www.linkedin.com/voyager/api";';
  assert.match(stripComments(sample), /\/\/www\.linkedin\.com\/voyager\/api/);
});

test("test_no_linkedin_vendor_delivery_adapter", () => {
  const channel = read("src/lib/linkedin-channel.ts");
  const dispatch = read("src/lib/dispatch-outbound.ts");
  assert.doesNotMatch(channel, /LINKEDIN_VENDOR_API_/);
  assert.doesNotMatch(channel, /vendorApiAdapter/);
  assert.doesNotMatch(channel, /async deliver\s*\(/);
  assert.doesNotMatch(dispatch, /adapter\.deliver/);
  assert.match(dispatch, /linkedin-channel-refused/);
  assert.equal(
    /export function linkedInAdapterForProvider/.test(channel),
    true,
  );
});

test("test_no_licdn_photo_host", async () => {
  const config = read("next.config.mjs");
  const photo = read("src/lib/candidate-photo.ts");
  assert.doesNotMatch(config, /licdn/i);
  assert.doesNotMatch(photo, /licdn/i);
  const { candidatePhotoUrl } = await import("../src/lib/candidate-photo.ts");
  const host = ["media", "licdn", "com"].join(".");
  assert.equal(candidatePhotoUrl(`https://${host}/dms/image/photo.jpg`), "");
});

test("test_no_agent_autopilot_tables", () => {
  const drops = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => /^\d+_.*\.sql$/.test(name) && name > "0009_")
    .map((name) => read(`supabase/migrations/${name}`))
    .join("\n");
  for (const table of ["agent_outreach", "agent_missions", "agent_campaign_autopilots", "agent_delegations"]) {
    assert.match(drops, new RegExp(`drop table if exists public\\.${table}\\b`, "i"), `missing drop for ${table}`);
  }
});

test("test_no_agents_compose_service", () => {
  const compose = read("docker-compose.yml");
  assert.doesNotMatch(compose, /^ {2}agents:/m);
  assert.doesNotMatch(compose, /AGENT_RUNNER_SECRET/);
  assert.doesNotMatch(compose, /\/api\/agent\/tick/);
});

test("test_no_smartx_ui_scraping", () => {
  const hits: string[] = [];
  for (const file of executableFiles()) {
    const source = stripComments(read(file));
    if (/https?:\/\/arp\.mantu\.com/i.test(source) || (/arp\.mantu\.com/i.test(source) && /(?:\bfetch|\bpage\.goto|\bpuppeteer|\bplaywright|\bselenium)\s*\(/i.test(source))) {
      hits.push(`${file}: arp.mantu.com automation`);
    }
    if (/\bsmartx\b/i.test(source) && /(?:\bpuppeteer|\bplaywright|\bselenium|\bpage\.goto)\s*\(/i.test(source)) {
      hits.push(`${file}: SmartX browser automation`);
    }
  }
  assert.deepEqual(hits, []);
});
