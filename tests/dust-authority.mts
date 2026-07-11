import { existsSync, readFileSync } from "node:fs";
import { mock } from "node:test";
import { NextRequest } from "next/server";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}
function source(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let workspaceStateReads = 0;
let dustRuns = 0;

const session = {
  auth: { getUser: async () => ({ data: { user: { id: "member-1" } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? "member" : workspaceId,
    error: null,
  }),
  from: (table: string) => {
    if (table === "workspace_state") workspaceStateReads += 1;
    const query: any = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: {
          state: {
            settings: {
              dust: {
                workspaceId: "member-selected-dust-workspace",
                apiKeyId: "11111111-1111-4111-8111-111111111111",
                region: "eu",
                agentLocks: { jdAnalysis: "member-selected-agent" },
              },
            },
          },
        },
        error: null,
      }),
    };
    return query;
  },
};

const service = {
  from: (table: string) => {
    const query: any = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({
        data:
          table === "api_keys"
            ? { secret: "encrypted-any-provider-secret", workspace_id: workspaceId }
            : null,
        error: null,
      }),
    };
    return query;
  },
};

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => service,
    requireAdmin: async () => ({ ok: false, response: new Response(null, { status: 403 }) }),
  },
});
mock.module(moduleUrl("src/lib/crypto-secrets.ts"), {
  namedExports: { decryptSecret: () => "decrypted-any-provider-secret" },
});
mock.module(moduleUrl("src/lib/dust/client.ts"), {
  namedExports: {
    listDustAgents: async () => [],
    runDustAgent: async () => {
      dustRuns += 1;
      return { ok: true, text: "unsafe execution" };
    },
  },
});

const route = await import("../src/app/api/dust/run/route");
const response = await route.POST(
  new NextRequest("http://localhost/api/dust/run", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() },
    body: JSON.stringify({ task: "jdAnalysis", message: "Confidential role data" }),
  }),
);
const body = (await response.json()) as { ok?: boolean };

ok("member-controlled workspace state cannot authorize a Dust run", body.ok === false && dustRuns === 0);
ok("Dust execution never reads member-writable workspace_state", workspaceStateReads === 0);

const migration = source("supabase/migrations/0020_dust_authority.sql");
const databaseTest = source("tests/db/dust-authority.sql");
const databaseHarness = source("scripts/test-db-privileges.sh");
const authority = source("src/lib/integrations/dust-authority.ts");
const runRoute = source("src/app/api/dust/run/route.ts");
const configRoute = source("src/app/api/integrations/dust/config/route.ts");
const stateMigration = source("src/lib/store/migrations.ts");
const settingsPanel = source("src/components/settings/dust-agent-panel.tsx");
const intakePage = source("src/app/intake/page.tsx");

ok("normalized Dust authority migration exists", migration.length > 0);
ok("Dust authority resolver exists", authority.length > 0);
ok("admin-owned Dust config route exists", configRoute.length > 0);
ok("migration creates normalized Dust connections", /create table[^;]+dust_connections/is.test(migration));
ok("real Dust database authority test exists", databaseTest.length > 0);
for (const marker of [
  "wrong-provider Dust credential binding is rejected",
  "foreign-workspace Dust credential binding is rejected",
  "Dust revision and immutable authority fields are database-owned",
  "member can read same-workspace Dust connection metadata",
  "admin cannot read a foreign workspace Dust connection",
  "service role can read normalized Dust connections",
  "service role cannot write normalized Dust connections",
  "service role cannot execute Dust trigger helpers",
  "Dust audit events are append-only and non-secret",
  "admin cannot update Dust audit events directly",
]) {
  ok(`real Dust database test covers ${marker}`, databaseTest.includes(marker));
}
ok(
  "real Dust database test changes effective PostgreSQL roles and JWT claims",
  /set local role authenticated/i.test(databaseTest) &&
    /set local role service_role/i.test(databaseTest) &&
    /set local role anon/i.test(databaseTest) &&
    /request\.jwt\.claims/i.test(databaseTest),
);
ok(
  "disposable database harness runs Dust authority verification",
  /tests\/db\/dust-authority\.sql/.test(databaseHarness),
);
ok(
  "migration creates append-only non-secret Dust audit storage",
  /create table[^;]+dust_connection_events/is.test(migration) &&
    /config_hash\s+text/i.test(migration) &&
    /action\s+text/i.test(migration),
);
ok(
  "migration gives only admins authenticated visibility into Dust audit events",
  /create policy[^;]+admins read Dust connection events[^;]+current_profile_role\(\)\s*=\s*'admin'/is.test(
    migration,
  ),
);
ok(
  "migration hashes structured Dust authority without copying configuration",
  /audit_dust_connection_authority/i.test(migration) &&
    /digest\(\s*jsonb_build_array\(/i.test(migration) &&
    !/insert into public\.dust_connection_events[\s\S]*?agent_locks/i.test(migration),
);
ok(
  "Dust audit reads have a tenant and connection index",
  /create index if not exists [^\n]+[\s\S]*?on public\.dust_connection_events\s*\(workspace_id, connection_id, created_at desc\)/i.test(
    migration,
  ),
);
ok(
  "migration binds a Dust credential to key, workspace, and provider",
  /foreign key\s*\(api_key_id,\s*workspace_id,\s*credential_provider\)/i.test(migration),
);
ok("migration restricts configuration mutations to admins", /current_profile_role\(\)\s*=\s*'admin'/i.test(migration));
ok("migration gives the service resolver explicit read access", /grant\s+select\s+on\s+public\.dust_connections\s+to\s+service_role/i.test(migration));
ok("migration strips untrusted legacy Dust JSON authority", /strip_legacy_dust_authority/i.test(migration));
ok("Dust execution resolves canonical authority", /resolveDustAuthority/.test(runRoute));
ok("Dust execution source no longer references workspace_state", !/workspace_state/.test(runRoute));
ok("Dust key resolution binds provider and valid status", /provider["']?,?\s*["']Dust|\.eq\(["']provider["'],\s*["']Dust["']\)/.test(authority) && /\.eq\(["']status["'],\s*["']valid["']\)/.test(authority));
ok("Dust config mutations require admin authority", /requireAdmin\(/.test(configRoute));
ok("client normalization removes legacy Dust authority", /delete\s+cleaned\.dust/.test(stateMigration));
ok(
  "Dust settings panel reads normalized config instead of shared state",
  /api\/integrations\/dust\/config/.test(settingsPanel) && !/useDustSettings/.test(settingsPanel),
);
ok(
  "intake delegates Dust lock resolution to normalized server authority",
  /runDustTask\(["']jdAnalysis["']/.test(intakePage) && !/settings\.dust/.test(intakePage),
);

console.log(`RESULT dust-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
