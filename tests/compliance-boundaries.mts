/**
 * Compliance boundaries (twa-odoo PR 1).
 *
 * These tests fail while a banned path is present and fail again if it
 * reappears. They scan product code, tests, docs, Docker, GitHub workflows,
 * and SQL, and they skip node_modules, .git, and historical note folders.
 * Historical migrations 0006–0009 stay immutable; 0010 and 0011 drop what
 * they created. A stored or rejected profile path is not a call. A bare
 * host, a CDN host, or a request is.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = process.cwd();

/**
 * Tony WALTEUR, 20:30 BRT, 20 Nov 2026: "Yes, build the Aria LinkedIn token
 * option as an off-by-default switch with those safeguards."
 *
 * PR #178 (card t1876s7747) is that port. Its only allowed path, for
 * server-side session-cookie sends, is src/channels/linkedin-token/.
 * This PR does not add the channel. Session cookies, the professional-network
 * host, its CDN, protocol-relative URLs, and split host strings stay banned
 * in every other file. The old unflagged vendor route stays banned in every
 * directory, including this one.
 */
const LINKEDIN_TOKEN_CHANNEL_ALLOWLIST = [
  "src/channels/linkedin-token/",
] as const;

function isLinkedInTokenChannelFile(file: string): boolean {
  return LINKEDIN_TOKEN_CHANNEL_ALLOWLIST.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix));
}

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
  { label: "vendor delivery adapter", pattern: /vendorApiAdapter/ },
];

/** Banned everywhere, including the future token-channel directory. */
const GLOBALLY_BANNED_TOKEN_LABELS = new Set([
  "aria_lnb_ pairing prefix",
  "LINKEDIN_VENDOR_API_ env",
  "LINKEDIN_BRIDGE_ env",
  "AGENTS_LINKEDIN_ALLOWLIST",
  "Voyager API",
  "bridge token mint",
  "extension directory",
  "bridge library",
  "bridge API route",
  "vendor delivery adapter",
]);

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
    const tokenChannel = isLinkedInTokenChannelFile(file);
    for (const { label, pattern } of TOKEN_PATTERNS) {
      if (tokenChannel && !GLOBALLY_BANNED_TOKEN_LABELS.has(label)) continue;
      if (pattern.test(source)) hits.push(`${file}: ${label}`);
    }
    if (!tokenChannel && /csrf-token/i.test(raw) && /voyager/i.test(raw)) hits.push(`${file}: csrf-token with voyager`);
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
    if (isLinkedInTokenChannelFile(file)) continue;
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

const LINKEDIN_NETWORK_CALL =
  /(?:\baxios\s*\.\s*(?:get|post|put|patch|delete|head|request|create)|\bgot(?:\.[A-Za-z]+)?\s*\(|\bhttps?\s*\.\s*(?:request|get)\s*\(|\bundici\s*\.\s*(?:request|fetch|stream)\s*\(|\bpage\s*\.\s*goto\s*\(|\bfetch\s*\()/i;

/** A transport call aimed at a linkedin.com host. A stored profile path is not a call. */
export function isLinkedInHostNetworkCall(line: string): boolean {
  return /linkedin\.com/i.test(line) && LINKEDIN_NETWORK_CALL.test(line);
}

const STORED_OR_REJECTED_PROFILE = /linkedin\.com\/(?:in|pub|company|school)\b/i;
const HOST_CHECK_FILES = new Set([
  "src/lib/linkedin-profile-url.ts",
  "src/lib/candidate-evidence.ts",
  "src/lib/rules.ts",
  "src/lib/sourcing/sourcing-agent-contract.ts",
]);

test("test_no_linkedin_com_or_licdn_outside_stored_profiles", () => {
  const hits: string[] = [];
  for (const file of executableFiles()) {
    const lines = read(file).split(/\n/);
    lines.forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      if (/licdn/i.test(line) && !isLinkedInTokenChannelFile(file)) hits.push(`${where}: licdn`);
      if (isLinkedInHostNetworkCall(line)) {
        hits.push(`${where}: network call to linkedin.com`);
        return;
      }
      if (isLinkedInTokenChannelFile(file)) return;
      if (!/linkedin\.com/i.test(line) || STORED_OR_REJECTED_PROFILE.test(line)) return;
      const request = /fetch\s*\(|\bsite:|voyager|axios|img-src|host_permissions|allowed_domains/i.test(line);
      if (HOST_CHECK_FILES.has(file) && !request) return;
      hits.push(`${where}: linkedin.com outside a stored or rejected profile path`);
    });
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("test_linkedin_network_call_ignores_stored_path_allowance", () => {
  const calls = [
    "axios.get('https://www.linkedin.com/in/someone')",
    "got('https://www.linkedin.com/in/someone')",
    "http.request('https://www.linkedin.com/in/someone')",
    "https.request('https://www.linkedin.com/in/someone')",
    "undici.request('https://www.linkedin.com/in/someone')",
    "page.goto('https://www.linkedin.com/in/someone')",
    "fetch('https://www.linkedin.com/in/someone')",
  ];
  for (const sample of calls) {
    assert.equal(isLinkedInHostNetworkCall(sample), true, sample);
  }
  assert.equal(isLinkedInHostNetworkCall("const url = 'https://www.linkedin.com/in/someone'"), false);
});

test("test_bridge_drop_keeps_rows_without_legal_hold_clearance", () => {
  const sql = read("supabase/migrations/0010_drop_linkedin_bridge.sql");
  assert.match(sql, /aria\.bridge_legal_hold_cleared/);
  assert.match(sql, /deletes no bridge rows/i);
  assert.doesNotMatch(sql, /^drop table\b/im);
});

test("test_linkedin_token_channel_allowlist_has_exactly_one_entry", () => {
  assert.equal(LINKEDIN_TOKEN_CHANNEL_ALLOWLIST.length, 1);
  const source = read("tests/compliance-boundaries.mts");
  const block = source.match(/const LINKEDIN_TOKEN_CHANNEL_ALLOWLIST = \[([\s\S]*?)\] as const;/);
  assert.ok(block, "LINKEDIN_TOKEN_CHANNEL_ALLOWLIST must stay a single constant");
  const entries = [...block[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(entries, ["src/channels/linkedin-token/"]);
  assert.deepEqual(entries, [...LINKEDIN_TOKEN_CHANNEL_ALLOWLIST]);
  assert.equal(entries.length, 1);
  const prefix = entries[0];
  assert.match(prefix, /\/$/);
  assert.equal(prefix.includes(".."), false);
  assert.equal(isLinkedInTokenChannelFile("src/channels/linkedin-token/client.ts"), true);
  assert.equal(isLinkedInTokenChannelFile("src/channels/other/client.ts"), false);
  assert.equal(isLinkedInTokenChannelFile("services/channels/linkedintoken/client.ts"), false);
  for (const banned of [
    "extensions/linkedin-bridge",
    "src/lib/linkedin-bridge",
    "src/app/api/linkedin",
    "src/lib/linkedin-channel.ts",
    "next.config.mjs",
  ]) {
    assert.equal(isLinkedInTokenChannelFile(banned), false, banned);
    assert.equal(banned.startsWith(prefix), false, banned);
  }
  assert.equal(GLOBALLY_BANNED_TOKEN_LABELS.has("LINKEDIN_VENDOR_API_ env"), true);
  assert.equal(GLOBALLY_BANNED_TOKEN_LABELS.has("vendor delivery adapter"), true);
  assert.equal(GLOBALLY_BANNED_TOKEN_LABELS.has("li_at session cookie"), false);
});

test("test_no_linkedin_integration_surface", () => {
  assert.equal(existsSync(join(root, "src/app/api/linkedin")), false);
  assert.equal(existsSync(join(root, "src/app/linkedin")), false);
  assert.equal(existsSync(join(root, "src/components/linkedin")), false);
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(names.filter((name) => /linkedin|licdn|voyager/i.test(name)), []);
  assert.doesNotMatch(read("next.config.mjs"), /linkedin\.com|licdn/i);
  for (const file of walk(".github", /.*/)) {
    assert.doesNotMatch(read(file), /linkedin|licdn/i, file);
  }
  for (const file of [".env.local.example", ".env.production.example", "docker-compose.yml"]) {
    if (!existsSync(join(root, file))) continue;
    assert.doesNotMatch(read(file), /LINKEDIN_|linkedin\.com|licdn/i, file);
  }
});

test("test_forward_only_drop_is_safe_on_existing_dbs", () => {
  for (const file of [
    "supabase/migrations/0010_drop_linkedin_bridge.sql",
    "supabase/migrations/0011_drop_agent_autopilot.sql",
  ]) {
    const sql = read(file);
    assert.match(sql, /forward-only/i, file);
    assert.match(sql, /no down migration/i, file);
    assert.match(sql, /unapplied/i, file);
    assert.match(sql, /existing database/i, file);
    assert.match(sql, /drop table if exists/i, file);
    assert.doesNotMatch(sql, /\bcreate table\b/i, file);
    assert.doesNotMatch(sql, /\bcascade\b/i, file);
  }
  assert.match(read("supabase/migrations/0010_drop_linkedin_bridge.sql"), /token_hash/);
});

test("test_no_skip_or_xfail_without_reason", () => {
  const hits: string[] = [];
  for (const file of walk("tests", /\.(?:mts|mjs|ts|js|sh)$/)) {
    const lines = read(file).split(/\n/);
    lines.forEach((line, index) => {
      const bareSkip = /\b(?:test|it|describe)\.skip\b|\bxfail\b|\bxtest\b|\bxit\b|\bskip\s*:\s*true\b/.test(line);
      if (!bareSkip) return;
      const reason = `${lines[index - 1] ?? ""}\n${line}`;
      if (!/reason:/i.test(reason)) hits.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(hits, [], `skip or xfail without a reason:\n${hits.join("\n")}`);
});

test("test_spec_derived_boundary_tests_present", () => {
  const source = read("tests/compliance-boundaries.mts");
  for (const name of [
    "test_no_linkedin_extension_token_path",
    "test_no_linkedin_dot_com_egress",
    "test_no_linkedin_vendor_delivery_adapter",
    "test_no_licdn_photo_host",
    "test_no_linkedin_com_or_licdn_outside_stored_profiles",
    "test_linkedin_network_call_ignores_stored_path_allowance",
    "test_bridge_drop_keeps_rows_without_legal_hold_clearance",
    "test_linkedin_token_channel_allowlist_has_exactly_one_entry",
    "test_no_linkedin_integration_surface",
    "test_forward_only_drop_is_safe_on_existing_dbs",
    "test_no_agent_autopilot_tables",
    "test_no_agents_compose_service",
    "test_no_scraper_or_enrichment_vendor",
    "test_no_heyreach_call_unless_flag_on_and_approval_present",
    "test_no_smartx_ui_scraping",
  ]) {
    assert.match(source, new RegExp(`test\\("${name}"`));
  }
});

test("property_stored_profile_url_is_not_a_fetch", async () => {
  const { publicIdFromProfileUrl, linkedInProfileUrl } = await import("../src/lib/linkedin-profile-url.ts");
  const { candidatePhotoUrl } = await import("../src/lib/candidate-photo.ts");
  let state = 0xc0ffee;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 64; i += 1) {
    const length = 3 + (next() % 20);
    let id = "";
    for (let n = 0; n < length; n += 1) id += alphabet[next() % alphabet.length];
    const url = linkedInProfileUrl(id);
    assert.equal(publicIdFromProfileUrl(url), id);
    assert.match(url, /^https:\/\/www\.linkedin\.com\/in\//);
    assert.equal(candidatePhotoUrl(url), "");
    assert.equal(publicIdFromProfileUrl(`https://evil.example/in/${id}`), null);
  }
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
