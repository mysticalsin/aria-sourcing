import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { hermesRuntimeMisconfigured } from "@/lib/api/url";
import { evaluateReadiness, type MigrationIdentity, type MigrationState } from "@/lib/readiness";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { getServiceSupabase } from "@/lib/supabase/server";
import {
  agentFrameworkRuntimeFromEnvironment,
  probeAgentFrameworkAdapters,
} from "@/lib/agents/framework/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const releaseSha = process.env.ARIA_RELEASE_SHA ?? "";
const expectedMigration = process.env.ARIA_EXPECTED_MIGRATION ?? "";
const expectedMigrationSha = process.env.ARIA_EXPECTED_MIGRATION_SHA ?? "";
const expectedMigrationCountRaw = process.env.ARIA_EXPECTED_MIGRATION_COUNT ?? "";
const expectedMigrationCount = /^[1-9][0-9]*$/.test(expectedMigrationCountRaw)
  ? Number(expectedMigrationCountRaw)
  : Number.NaN;
const expectedLedgerSha256 = process.env.ARIA_EXPECTED_LEDGER_SHA ?? "";
const agentFrameworksRequired =
  process.env.AGENT_FRAMEWORKS_REQUIRED === "true"
    ? true
    : process.env.AGENT_FRAMEWORKS_REQUIRED === "false"
      ? false
      : process.env.NODE_ENV === "production";

export async function GET(req: Request) {
  // Unauthenticated deep-readiness probe: 3 DB queries + adapter network
  // probes per call. Throttle per IP so it can't be turned into a cheap DoS.
  // Liveness monitors should hit the far cheaper /api/health instead.
  const limit = checkRateLimit(rateLimitKey(req, "ready"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  try {
    const client = getServiceSupabase();
    const authHealthUrl = new URL("/auth/v1/health", SUPABASE_URL).toString();

    const result = await evaluateReadiness(
      {
        releaseSha,
        expectedMigration,
        expectedMigrationSha,
        expectedMigrationCount,
        expectedLedgerSha256,
        agentFrameworksRequired,
        // Evaluated per request, not at module load: HERMES_API_URL and
        // HERMES_ALLOWED_HOSTS are deployment config, and a probe that answered
        // from a cached module-load reading would keep reporting the old verdict
        // after the config was corrected.
        hermesRuntimeMisconfigured: hermesRuntimeMisconfigured(process.env.HERMES_API_URL),
      },
      {
        database: async () => {
          if (!client) return false;
          const { error } = await client
            .from("workspace_state")
            .select("workspace_id")
            .limit(1)
            .abortSignal(AbortSignal.timeout(3_000));
          return error === null;
        },
        queue: async () => {
          if (!client) return false;
          const { error } = await client
            .from("messages_outbound")
            .select("id")
            .limit(1)
            .abortSignal(AbortSignal.timeout(3_000));
          return error === null;
        },
        agentFrameworks: async () => {
          const runtime = agentFrameworkRuntimeFromEnvironment();
          return probeAgentFrameworkAdapters(runtime.config, runtime.tokens);
        },
        migration: async (): Promise<MigrationState | null> => {
          if (!client) return null;
          const { data, error } = await client
            .from("aria_schema_migrations")
            .select("filename,sha256")
            .order("filename", { ascending: true })
            .abortSignal(AbortSignal.timeout(3_000));
          if (error || !Array.isArray(data)) return null;

          const entries: MigrationIdentity[] = [];
          for (const row of data) {
            if (
              typeof row?.filename !== "string" ||
              typeof row?.sha256 !== "string" ||
              !/^0[0-9]{3}_[A-Za-z0-9_]+\.sql$/.test(row.filename) ||
              !/^[0-9a-f]{64}$/.test(row.sha256)
            ) {
              return null;
            }
            entries.push({ filename: row.filename, sha256: row.sha256 });
          }

          const ledgerSha256 = createHash("sha256")
            .update(entries.map(({ filename, sha256 }) => `${filename}:${sha256}\n`).join(""))
            .digest("hex");
          return {
            latest: entries.at(-1) ?? null,
            count: entries.length,
            ledgerSha256,
          };
        },
        auth: async () => {
          if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
          const response = await fetch(authHealthUrl, {
            cache: "no-store",
            headers: { apikey: SUPABASE_ANON_KEY },
            signal: AbortSignal.timeout(3_000),
            redirect: "error",
          });
          return response.status === 200 && response.url === authHealthUrl;
        },
      },
    );

    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, status: "not_ready" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
