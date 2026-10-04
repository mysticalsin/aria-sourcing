#!/usr/bin/env node
/**
 * Prove durable LLM wiki brain + live GitHub sourcing for Java Developer opps.
 * Usage: npx tsx scripts/prove-llm-wiki-java-sourcing.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const wikiRoot = path.join(os.tmpdir(), `aria-wiki-java-${Date.now()}`);
process.env.ARIA_WIKI_DIR = wikiRoot;

const { seedJavaDeveloperWiki, FileWikiKnowledgePlane } = await import(
  pathToFileURL(path.join(root, "src/lib/knowledge-plane.ts")).href
);

const workspaceId = "__local__";
const campaignId = "camp_java_dev";
const plane = new FileWikiKnowledgePlane(wikiRoot);

console.log("== 1. Seed LLM wiki brain (not Supabase) ==");
const snap = await seedJavaDeveloperWiki(workspaceId, campaignId, plane);
console.log(`wikiPath: ${snap.wikiPath}`);
console.log(`notes: ${snap.notes.length}  edges: ${snap.edges.length}`);
console.log(`grantsContactClaim: ${snap.grantsContactClaim}`);
for (const n of snap.notes) {
  console.log(`  [${n.kind}] ${n.title}`);
}

const query =
  plane.suggestGithubQuery(workspaceId, campaignId) || "language:Java followers:>20";
console.log("\n== 2. Wiki-suggested GitHub query ==");
console.log(query);
console.log("\nDraft context (recall only):");
console.log(plane.compileDraftContext(workspaceId, campaignId).slice(0, 600));

console.log("\n== 3. Live GitHub search for Java developers ==");
const token = process.env.GITHUB_TOKEN?.trim() || "";
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "aria-sourcing-prove",
};
if (token) headers.Authorization = `Bearer ${token}`;

const effectiveQuery = `${query} type:user`;
const searchRes = await fetch(
  `https://api.github.com/search/users?q=${encodeURIComponent(effectiveQuery)}&per_page=8`,
  { headers },
);
if (!searchRes.ok) {
  console.error(`GitHub search failed: ${searchRes.status} ${await searchRes.text()}`);
  process.exit(1);
}
const searchBody = await searchRes.json();
const logins = (searchBody.items ?? []).map((u) => u.login).filter(Boolean).slice(0, 8);

const out = [];
for (const login of logins) {
  const uRes = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers,
  });
  if (!uRes.ok) continue;
  const u = await uRes.json();
  const row = {
    login: String(u.login ?? login),
    name: u.name ?? null,
    company: u.company ?? null,
    location: u.location ?? null,
    htmlUrl: String(u.html_url ?? `https://github.com/${login}`),
    publicRepos: Number(u.public_repos ?? 0),
    followers: Number(u.followers ?? 0),
    bio: u.bio ? String(u.bio).slice(0, 140) : null,
  };
  out.push(row);
  console.log(`- ${row.name || row.login}  @${row.login}`);
  console.log(`  ${row.htmlUrl}`);
  console.log(
    `  ${row.location || "—"} · repos ${row.publicRepos} · followers ${row.followers}`,
  );
  if (row.bio) console.log(`  ${row.bio}`);
  console.log("");
}

const evidenceDir = path.join(root, "_relay", "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const evidencePath = path.join(evidenceDir, "2026-09-08-llm-wiki-java-sourcing.json");
fs.writeFileSync(
  evidencePath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      brainStore: "llm-wiki",
      wikiRoot,
      campaignId,
      grantsContactClaim: false,
      query,
      noteCount: snap.notes.length,
      profiles: out,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Found ${out.length} real profiles`);
console.log(`== Evidence written: ${evidencePath} ==`);
console.log(`RESULT prove-llm-wiki-java-sourcing: ${out.length} profiles`);
if (out.length < 3) process.exitCode = 1;
