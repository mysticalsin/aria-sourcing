import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync("supabase/migrations/0033_candidate_erasure_authority.sql", "utf8");
const store = readFileSync("src/lib/store.ts", "utf8");
const contracts = readFileSync("src/lib/store/contracts.ts", "utf8");
const drawer = readFileSync("src/components/candidates/candidate-drawer.tsx", "utf8");
const openapi = readFileSync("docs/api/openapi.yaml", "utf8");

test("migration defines tenant-bound erasure, legal hold, content-free receipts, and provider outbox authority", () => {
  for (const table of [
    "candidate_legal_holds",
    "candidate_erasure_requests",
    "candidate_erasure_receipts",
    "candidate_erasure_obligations",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /request_candidate_erasure\(/);
  assert.match(migration, /workspace_id[\s\S]*candidate_id[\s\S]*campaign_id/);
  assert.match(migration, /blocked_legal_hold/);
  assert.match(migration, /pending_provider/);
  assert.match(migration, /manual_required/);
  assert.match(migration, /retryable_failure/);
  assert.match(migration, /completed/);
  assert.match(migration, /enforce_candidate_erasure_obligation_limit/);
  assert.match(migration, /existing_count >= 100/);
  assert.match(migration, /errcode = '54000'/);
  assert.doesNotMatch(
    migration.match(/create table if not exists public\.candidate_erasure_receipts[\s\S]*?\);/)?.[0] ?? "",
    /\b(content|email|phone|name|address|payload)\b/i,
  );
});

test("canonical route replaces the Apollo-only client flow and returns typed non-final states", () => {
  const start = store.indexOf("const anonymizeCandidate = useCallback(async");
  const end = store.indexOf("const exportCandidate", start);
  const action = store.slice(start, end);
  assert.match(action, /workspaceFetch\("\/api\/admin\/candidates\/erasure"/);
  assert.doesNotMatch(action, /\/api\/admin\/source\/apollo\/erasure/);
  assert.match(contracts, /manual_required/);
  assert.match(contracts, /pending_provider/);
  assert.match(contracts, /retryable_failure/);
  assert.match(contracts, /blocked_legal_hold/);
  assert.match(store, /candidate_erasure_obligation_limit_exceeded/);
  assert.match(drawer, /Provider action required/);
  assert.match(drawer, /Erasure blocked by legal hold/);
});

test("durable queue preserves a late legal-hold state after reload", () => {
  const parserStart = drawer.indexOf("function parseCandidateErasureObligations");
  const parserEnd = drawer.indexOf("function Section", parserStart);
  const parser = drawer.slice(parserStart, parserEnd);
  const queueStart = drawer.indexOf("const refreshErasureQueue");
  const queueEnd = drawer.indexOf("useEffect(() =>", queueStart);
  const queue = drawer.slice(queueStart, queueEnd);

  assert.match(parser, /"blocked_legal_hold"/);
  assert.match(queue, /"blocked_legal_hold"/);
  assert.match(queue, /method: "PATCH"/);
  assert.match(queue, /body: JSON\.stringify\(\{ action: "list" \}\)/);
});

test("candidate erasure UI invalidates stale work and treats a late legal hold as typed authority", () => {
  assert.match(drawer, /erasureGenerationRef/);
  assert.match(drawer, /erasureControllersRef/);
  assert.match(drawer, /new AbortController\(\)/);
  assert.match(drawer, /signal: controller\.signal/);
  assert.match(drawer, /isErasureScopeCurrent/);
  assert.match(drawer, /response\.status === 423[\s\S]*candidate_erasure_blocked_legal_hold/);
  assert.match(drawer, /setErasureAuthority\(null\)/);
  assert.match(drawer, /setErasureEvidenceSha256\(""\)/);
  assert.match(drawer, /setErasureCaseReference\(""\)/);
  assert.match(drawer, /await refreshErasureQueue\(\)/);
  assert.match(drawer, /Erasure is blocked by a legal hold/);
});

test("a validated erasure receipt masks stale PII and cannot be undone", () => {
  const anonymizeStart = store.indexOf("const anonymizeCandidate = useCallback(async");
  const anonymizeEnd = store.indexOf("const exportCandidate", anonymizeStart);
  const anonymize = store.slice(anonymizeStart, anonymizeEnd);
  const handlerStart = drawer.indexOf("const handleAnonymize = async");
  const handlerEnd = drawer.indexOf("const handleInspectErasureAuthority", handlerStart);
  const handler = drawer.slice(handlerStart, handlerEnd);
  const restoreStart = store.indexOf("const restoreCandidateContact = useCallback");
  const restoreEnd = store.indexOf("const unsubscribeCandidate", restoreStart);
  const restore = store.slice(restoreStart, restoreEnd);

  assert.match(store, /preserveCandidateErasureTombstones\(base, fn\(base\)\)/);
  assert.match(store, /if \(isCandidateErasureTombstone\(cand\)\) return s/);
  assert.match(restore, /if \(!cand \|\| isCandidateErasureTombstone\(cand\)\) return/);
  assert.match(anonymize, /anonymizeHermesState/);
  assert.ok(
    anonymize.indexOf("anonymizeHermesState") < anonymize.indexOf("await hydrateWorkspace()"),
    "the local candidate must be masked before a fallible workspace refresh",
  );
  assert.match(handler, /onClose\(\)/);
  assert.match(
    handler,
    /result\.status === "blocked_legal_hold"[\s\S]*applyErasureLegalHold\(scope, result\.requestId\)[\s\S]*await refreshErasureQueue\(\)/,
  );
  assert.match(drawer, /const erasureTombstone = isCandidateErasureTombstone\(c\)/);
  assert.match(drawer, /!erasureTombstone && c\.sourcePlatform === "Apollo"/);
  assert.match(drawer, /masked && !erasureTombstone/);
  assert.doesNotMatch(
    drawer.match(/\{\(flags\.suppressed \|\| flags\.doNotContact\)[\s\S]*?Undo: restore contact[\s\S]*?\}\)/)?.[0] ?? "",
    /Undo: restore contact/,
  );
});

test("OpenAPI documents the canonical idempotent erasure state machine", () => {
  assert.match(openapi, /\/api\/admin\/candidates\/erasure:/);
  assert.match(openapi, /Idempotency-Key/);
  assert.match(openapi, /candidate_erasure_blocked_legal_hold/);
  assert.match(openapi, /candidate_erasure_obligation_limit_exceeded/);
  assert.match(openapi, /manual_required/);
  assert.match(openapi, /retryable_failure/);
  assert.match(openapi, /'202':/);
  assert.match(openapi, /'423':/);
  assert.match(openapi, /administrator-recorded/i);
  assert.doesNotMatch(openapi, /record verified provider deletion/i);
  assert.doesNotMatch(drawer, /Record verified deletion/);
});
