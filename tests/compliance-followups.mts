/**
 * Sentinel follow-ups on the compliance PR. These assertions fail until the
 * database, dispatcher, migration gate, detector, weekly scan, and email
 * normalisation land.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { isLinkedInHostNetworkCall } from "./compliance-boundaries.mts";
import { normalizeSuppressionValue } from "../src/lib/manual-suppression.ts";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

test("L-1 lawful basis is enforced inside approval, enqueue, and dispatch", () => {
  const later = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => /^\d+_.*\.sql$/.test(name) && name > "0001_")
    .map((name) => read(`supabase/migrations/${name}`))
    .join("\n");
  assert.match(later, /create or replace function public\.record_outreach_approval/i);
  assert.match(later, /create or replace function public\.enqueue_email_outbound/i);
  assert.match(later, /lawful-basis-required/);
  assert.match(later, /candidate_has_operator_lawful_basis/);
  const dispatch = read("src/lib/dispatch-outbound.ts");
  const basis = dispatch.indexOf("recordedLawfulBasisFromUnknown");
  const claim = dispatch.indexOf("claim_email_outbound_queued");
  assert.ok(basis >= 0 && claim >= 0 && basis < claim);
});

test("L-2 autopilot drop keeps rows unless the legal-hold flag is set", () => {
  const sql = read("supabase/migrations/0011_drop_agent_autopilot.sql");
  assert.match(sql, /aria\.bridge_legal_hold_cleared/);
  assert.match(sql, /deletes no autopilot rows/i);
  assert.doesNotMatch(sql, /^drop table\b/im);
  assert.doesNotMatch(sql, /\bcascade\b/i);
  for (const table of ["agent_outreach", "agent_missions", "agent_campaign_autopilots", "agent_delegations"]) {
    assert.match(sql, new RegExp(`drop table if exists public\\.${table}\\b`, "i"));
  }
});

test("L-3 detector catches split, joined, env, and multi-line calls", () => {
  const samples = [
    "axios.get(\n  'https://www.linkedin.com/in/someone')",
    "got('https://www.' + 'linked' + 'in.com' + '/in/someone')",
    "http.request('https://' + ['www', 'linkedin', 'com'].join('.') + '/in/someone')",
    "process.env.LINKEDIN_API_URL = 'https://www.linkedin.com';\nfetch(process.env.LINKEDIN_API_URL)",
  ];
  for (const sample of samples) {
    assert.equal(isLinkedInHostNetworkCall(sample), true, sample);
  }
  assert.equal(
    isLinkedInHostNetworkCall("fetch(process.env.ARIA_LINKEDIN_TOKEN_ALLOWED_HOST + '/messages')"),
    false,
  );
  assert.equal(isLinkedInHostNetworkCall("const url = 'https://www.linkedin.com/in/someone'"), false);
  const scanner = read("tests/compliance-boundaries.mts");
  assert.match(scanner, /isLinkedInHostNetworkCall\(raw\)/);
  assert.match(scanner, /ARIA_LINKEDIN_TOKEN_ALLOWED_HOST/);
});

test("L-4 weekly gitleaks scans every ref without changing pull request scans", () => {
  const path = ".github/workflows/gitleaks-weekly.yml";
  assert.equal(existsSync(join(root, path)), true);
  const workflow = read(path);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron:/);
  assert.match(workflow, /--log-opts='--all'/);
  const pullRequestScan = read(".github/workflows/ci.yml");
  assert.match(pullRequestScan, /--log-opts='HEAD'/);
  assert.doesNotMatch(pullRequestScan, /--log-opts='--all'/);
});

test("I-2 suppression emails are NFKC normalised and lowercased", () => {
  assert.equal(normalizeSuppressionValue("email", "\uFF21dmin@Example.COM"), "admin@example.com");
  assert.equal(normalizeSuppressionValue("email", " Person@Example.COM "), "person@example.com");
});
