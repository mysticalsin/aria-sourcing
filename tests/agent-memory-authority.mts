import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL: ${name}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const migrationPath = new URL("../supabase/migrations/0025_agent_memory_authority.sql", import.meta.url);
const routePath = new URL("../src/app/api/agents/run/route.ts", import.meta.url);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const route = readFileSync(routePath, "utf8");

ok("migration 0025 is reserved for agent-memory authority", migration.length > 0);
ok("normalized encrypted agent memories are created", /create table if not exists public\.agent_memories[\s\S]*content_ciphertext\s+text\s+not null/i.test(migration));
ok("memory rows persist plaintext byte count for pre-decryption receipt selection", /content_byte_count\s+integer\s+not null/i.test(migration));
ok("memory events are append-only and content-free", /create table if not exists public\.agent_memory_events[\s\S]*content_sha256[\s\S]*metadata/i.test(migration));
const eventTable = migration.match(/create table if not exists public\.agent_memory_events\s*\(([\s\S]*?)\n\);/i)?.[1] ?? "";
ok("memory events contain no plaintext or ciphertext column", eventTable.length > 0 && !/\bcontent(?:_ciphertext)?\s+text\b/i.test(eventTable));
ok("run-memory receipts contain revision and hash but no content", /create table if not exists public\.agent_run_memory_context[\s\S]*memory_revision[\s\S]*content_sha256/i.test(migration));
const receiptTable = migration.match(/create table if not exists public\.agent_run_memory_context\s*\(([\s\S]*?)\n\);/i)?.[1] ?? "";
ok("run-memory receipt schema is content-free", receiptTable.length > 0 && !/\bcontent(?:_ciphertext)?\s+text\b/i.test(receiptTable));
ok("legacy workspace memories have a dedicated quarantine", /create table if not exists public\.agent_memory_legacy_quarantine/i.test(migration));
const quarantineTable = migration.match(/create table if not exists public\.agent_memory_legacy_quarantine\s*\(([\s\S]*?)\n\);/i)?.[1] ?? "";
ok(
  "legacy quarantine is hash-only and contains no recoverable JSON or source identifiers",
  /payload_sha256\s+text\s+not null/i.test(quarantineTable)
    && !/\bpayload\s+jsonb\b/i.test(quarantineTable)
    && !/\blegacy_(?:memory|seat)_id\b/i.test(quarantineTable),
);
ok("legacy workspace memory is forced to an empty non-authoritative array", /jsonb_set\([\s\S]*\{memory\}[\s\S]*\[\]/i.test(migration));
ok("legacy workspace memory never backfills active agent_memories", !/insert\s+into\s+public\.agent_memories[\s\S]*workspace_state/i.test(migration));
ok("agent spec workspace and owner authority is immutable", /agent_spec[\s\S]*immutable[\s\S]*(owner_id|workspace_id)/i.test(migration));
ok("every new run stores its exact actor provenance", /alter table public\.agent_runs[\s\S]*add column if not exists actor_id\s+uuid/i.test(migration) && /insert into public\.agent_runs\s*\([\s\S]*actor_id/i.test(migration));
ok("new run actor provenance is mandatory and immutable", /enforce_agent_run_authority_immutable/i.test(migration) && /actor_id is distinct from old\.actor_id/i.test(migration));
ok("agent memories use an exact workspace-owner-spec foreign key", /foreign key\s*\(workspace_id,\s*owner_id,\s*spec_id\)[\s\S]*references public\.agent_specs\s*\(workspace_id,\s*owner_id,\s*id\)/i.test(migration));
ok("atomic run-context receipt RPC is service-role only", /create or replace function public\.create_agent_run_with_memory_context/i.test(migration) && /revoke all on function public\.create_agent_run_with_memory_context[\s\S]*authenticated/i.test(migration) && /grant execute on function public\.create_agent_run_with_memory_context[\s\S]*service_role/i.test(migration));
const receiptRpc = migration.match(/create or replace function public\.create_agent_run_with_memory_context[\s\S]*?\n\$\$;/i)?.[0] ?? "";
ok("receipt transaction locks the active spec against concurrent pause", /from public\.agent_specs[\s\S]*for share/i.test(receiptRpc));
ok("receipt transaction locks the exact active actor profile against concurrent revocation", /from public\.profiles(?:(?!;)[\s\S])*role\s*=\s*'admin'(?:(?!;)[\s\S])*for share/i.test(receiptRpc));
ok("receipt transaction locks selected memory against concurrent revocation", /from public\.agent_memories[\s\S]*for share/i.test(receiptRpc));
ok("receipt RPC selects bounded memory itself instead of trusting caller receipts", !/p_receipts\s+jsonb/i.test(receiptRpc) && /content_byte_count/i.test(receiptRpc));
ok("memory content changes force a fresh approval review", /content_ciphertext is distinct from old\.content_ciphertext[\s\S]*status\s*:=\s*'pending_review'/i.test(migration));
ok("memory source provenance is immutable", /source_type is distinct from old\.source_type[\s\S]*source_run_id is distinct from old\.source_run_id/i.test(migration));

const createdPolicies = [...migration.matchAll(/create policy\s+([a-zA-Z0-9_]+)/gi)].map((match) => match[1]);
ok(
  "every named policy is safely dropped before recreation",
  createdPolicies.length > 0 && createdPolicies.every((name) => new RegExp(`drop policy if exists ${name}\\s+on`, "i").test(migration)),
);
const namedConstraints = [...new Set([...migration.matchAll(/constraint\s+(agent_[a-zA-Z0-9_]+)/gi)].map((match) => match[1]))];
ok(
  "every named authority constraint is guarded or safely recreated",
  namedConstraints.length > 0 && namedConstraints.every((name) => {
    const safelyDropped = new RegExp(`drop constraint if exists ${name}`, "i").test(migration);
    const existenceGuard = new RegExp(`conname\\s*=\\s*'${name}'`, "i").test(migration);
    return safelyDropped || existenceGuard;
  }),
);

const postIndex = route.indexOf("export async function POST");
const specLookupIndex = route.indexOf('.from("agent_specs")', postIndex);
const keyLookupIndex = route.indexOf("resolveVaultSecret(", postIndex);
const tavilyKeyLookupIndex = route.indexOf("resolveStoredTavilyKey(", postIndex);
const memoryLoadIndex = route.indexOf("loadAgentMemoryContext(", postIndex);
const modelEgressIndex = route.indexOf("await fetch(", postIndex);
const runGraphIndex = route.indexOf("runGraph(", postIndex);
const contextReceiptIndex = route.indexOf("createAgentRunWithMemoryContext(", postIndex);

ok("agent run requires specId", /specId:\s*z\.string\(\)\.uuid\(\)\s*,/.test(route) && !/specId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/.test(route));
ok("agent run loads the exact stored spec", specLookupIndex > postIndex && /owner_id,\s*role_brief[\s\S]*\.eq\("status",\s*"active"\)/.test(route));
ok("stored spec authority precedes credential and model egress", specLookupIndex > postIndex && specLookupIndex < keyLookupIndex && specLookupIndex < modelEgressIndex);
ok("agent run never uses caller campaign authority", !route.includes("validated.data.campaign"));
ok("agent run never loads shared workspace memory", !route.includes('.from("workspace_state")'));
ok("agent run retrieves normalized bounded memory", route.includes("loadAgentMemoryContext("));
ok("run and memory receipts persist before the graph executes", contextReceiptIndex > postIndex && contextReceiptIndex < runGraphIndex);
ok(
  "atomic receipt persistence precedes every memory/provider key resolution",
  contextReceiptIndex > postIndex
    && contextReceiptIndex < memoryLoadIndex
    && contextReceiptIndex < keyLookupIndex
    && contextReceiptIndex < tavilyKeyLookupIndex
    && contextReceiptIndex < modelEgressIndex,
);
ok("run persistence failures fail closed", /Agent run (?:or context )?persistence failed/i.test(route));

type MemoryModule = typeof import("../src/lib/agents/memory.ts");
let memoryModule: MemoryModule | null = null;
let moduleLoadError = "";
try {
  memoryModule = await import("../src/lib/agents/memory.ts");
} catch (error) {
  moduleLoadError = error instanceof Error ? error.message : String(error);
}

ok(`agent memory context module exists${moduleLoadError ? ` (${moduleLoadError})` : ""}`, memoryModule !== null);

if (memoryModule) {
  const rows = Array.from({ length: 10 }, (_, index) => {
    const content = `${index}: ${"x".repeat(995)}`;
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      kind: "fact",
      content_ciphertext: `cipher:${content}`,
      content_sha256: sha256(content),
      revision: index + 1,
    };
  });
  const context = memoryModule.buildBoundedAgentMemoryContext(rows, {
    decrypt: (stored) => stored.replace(/^cipher:/, ""),
  });
  ok("memory item limit is fixed at eight", memoryModule.MAX_AGENT_MEMORY_ITEMS === 8 && context.items.length === 8);
  ok("memory byte budget is fixed and enforced", memoryModule.MAX_AGENT_MEMORY_BYTES === 8192 && context.totalBytes <= 8192);
  ok("receipts record id, revision, and hash", context.receipts.every((receipt) => receipt.memoryId && receipt.memoryRevision > 0 && /^[0-9a-f]{64}$/.test(receipt.contentSha256)));
  ok("receipts never copy plaintext or ciphertext", !JSON.stringify(context.receipts).includes("xxxxx") && !JSON.stringify(context.receipts).includes("cipher:"));

  let receiptedContextRejectedMismatch = false;
  if ("buildReceiptedAgentMemoryContext" in memoryModule) {
    const receipted = memoryModule.buildReceiptedAgentMemoryContext(
      rows.slice(0, 2),
      context.receipts.slice(0, 2),
      { decrypt: (stored) => stored.replace(/^cipher:/, "") },
    );
    ok("post-receipt memory reconstruction preserves the persisted selection", receipted.items.length === 2 && receipted.totalBytes === context.receipts.slice(0, 2).reduce((sum, receipt) => sum + receipt.byteCount, 0));
    try {
      memoryModule.buildReceiptedAgentMemoryContext(
        rows.slice(0, 2),
        [{ ...context.receipts[0], byteCount: context.receipts[0].byteCount + 1 }, context.receipts[1]],
        { decrypt: (stored) => stored.replace(/^cipher:/, "") },
      );
    } catch {
      receiptedContextRejectedMismatch = true;
    }
  }
  ok("post-receipt memory reconstruction rejects byte-count drift", receiptedContextRejectedMismatch);

  const applied = memoryModule.applyAgentMemoryContext("SYSTEM POLICY", "Role brief", context);
  ok("memory remains outside the system policy", !applied.system.includes(context.items[0]?.content ?? "missing"));
  ok("system policy labels memory as untrusted reference", /untrusted reference/i.test(applied.system));
  ok("memory is serialized below the user prompt", applied.prompt.indexOf("Role brief") < applied.prompt.indexOf("UNTRUSTED_AGENT_MEMORY") && applied.prompt.includes(context.items[0]?.content ?? "missing"));
  ok("internal memory ids are not disclosed to the model", !applied.prompt.includes(context.items[0]?.memoryId ?? "missing"));

  let hashMismatchRejected = false;
  try {
    memoryModule.buildBoundedAgentMemoryContext(
      [{ ...rows[0], content_sha256: "0".repeat(64) }],
      { decrypt: (stored) => stored.replace(/^cipher:/, "") },
    );
  } catch {
    hashMismatchRejected = true;
  }
  ok("memory hash mismatches fail closed", hashMismatchRejected);

  let oversizedRejected = false;
  const oversized = "z".repeat(memoryModule.MAX_AGENT_MEMORY_BYTES + 1);
  try {
    memoryModule.buildBoundedAgentMemoryContext(
      [{ ...rows[0], content_ciphertext: oversized, content_sha256: sha256(oversized) }],
      { decrypt: (stored) => stored },
    );
  } catch {
    oversizedRejected = true;
  }
  ok("a single oversized memory fails closed", oversizedRejected);
}

console.log(`RESULT agent-memory-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
