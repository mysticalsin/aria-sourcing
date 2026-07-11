import { mock } from "node:test";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let currentRow: Record<string, unknown> = {};
let selectedColumns = "";

const query = {
  select(columns: string) {
    selectedColumns = columns;
    return query;
  },
  eq() {
    return query;
  },
  single: async () => ({ data: currentRow, error: null }),
};
const session = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  rpc: async () => ({ data: workspaceId, error: null }),
};
const service = { from: () => query };

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => service,
  },
});
mock.module(moduleUrl("src/lib/crypto-secrets.ts"), {
  namedExports: { decryptSecret: (value: string) => `decrypted:${value}` },
});

const { resolveVaultSecret } = await import("../src/lib/ai/vault-secret");
const keyId = "11111111-1111-4111-8111-111111111111";

currentRow = {
  secret: "encrypted",
  workspace_id: workspaceId,
  provider: "Anthropic",
  status: "valid",
};
const mismatched = await resolveVaultSecret(keyId, "OpenAI");
ok("vault resolver rejects a key owned by another provider", mismatched === "");

currentRow = {
  secret: "encrypted",
  workspace_id: workspaceId,
  provider: "OpenAI",
  status: "invalid",
};
const invalid = await resolveVaultSecret(keyId, "OpenAI");
ok("vault resolver rejects a key that is not valid", invalid === "");

currentRow = {
  secret: "encrypted",
  workspace_id: workspaceId,
  provider: "OpenAI",
  status: "valid",
};
const valid = await resolveVaultSecret(keyId, "OpenAI");
ok("vault resolver decrypts a valid provider-bound key", valid === "decrypted:encrypted");
ok(
  "vault resolver loads provider and status for the authority decision",
  selectedColumns.includes("provider") && selectedColumns.includes("status"),
);

console.log(`RESULT vault-secret-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
