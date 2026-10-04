import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateApiKeyFormat } from "@/lib/providers";
import { isLiveLlmKeyProvider, testLlmApiKey } from "@/lib/ai/key-probe";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { testSillageConnection } from "@/lib/sourcing/sillage";
import { checkApolloAuth } from "@/lib/sourcing/apollo";
import { checkSeamlessAuth } from "@/lib/sourcing/seamless";
import { testApifyConnection } from "@/lib/sourcing/apify";
import { clearProviderProbe } from "@/lib/sourcing/provider-egress";

const ApiKeyTestSchema = z.object({
  provider: z.string().max(80).optional(),
  value: z.string().max(1000).optional(),
  id: z.string().uuid().optional(),
});

/**
 * Classify a live Sillage contents/query probe into a valid/invalid verdict.
 * 401 is the only "bad key" signal Sillage documents — any other status (even
 * 402/403/404/409/422/429) means the key itself authenticated, so it's honestly
 * reported valid with that status's own detail. A network/timeout error falls
 * back to the deterministic format check, flagged as inconclusive.
 */
function classifySillageTest(
  live: Awaited<ReturnType<typeof testSillageConnection>>,
  fallbackFormat: () => { valid: boolean; detail: string },
): { valid: boolean; detail: string } {
  if (live.ok) return { valid: true, detail: `Sillage key accepted (HTTP ${live.status}).` };
  if (live.status === 401) return { valid: false, detail: live.detail || live.title || "Sillage rejected this key (401)." };
  if (live.status === 0) {
    const fmt = fallbackFormat();
    return { valid: fmt.valid, detail: `${fmt.detail} Sillage was unreachable, format check only.` };
  }
  return { valid: true, detail: live.detail || live.title || `Sillage responded (HTTP ${live.status}).` };
}

async function testApolloKey(value: string): Promise<{ valid: boolean; detail: string }> {
  try {
    return await checkApolloAuth(clearProviderProbe("Apollo"), value);
  } catch {
    return validateApiKeyFormat("Apollo", value);
  }
}

async function testSeamlessKey(value: string): Promise<{ valid: boolean; detail: string }> {
  try {
    return await checkSeamlessAuth(clearProviderProbe("Seamless"), value);
  } catch {
    return validateApiKeyFormat("Seamless", value);
  }
}

async function testApifyKey(value: string): Promise<{ valid: boolean; detail: string }> {
  try {
    const live = await testApifyConnection(clearProviderProbe("Apify"), value);
    if (live.ok) return { valid: true, detail: `Apify key accepted (HTTP ${live.status}).` };
    if (live.status === 401) return { valid: false, detail: live.detail || live.title || "Apify rejected this key (401)." };
    if (live.status === 0) {
      const fmt = validateApiKeyFormat("Apify", value);
      return { valid: fmt.valid, detail: `${fmt.detail} Apify was unreachable, format check only.` };
    }
    return { valid: false, detail: live.detail || live.title || `Apify returned an unexpected HTTP ${live.status}.` };
  } catch {
    return validateApiKeyFormat("Apify", value);
  }
}

async function resolveKeyTest(
  provider: string,
  value: string,
): Promise<{ valid: boolean; detail: string }> {
  if (provider === "Sillage") {
    const live = await testSillageConnection(clearProviderProbe("Sillage"), value);
    return classifySillageTest(live, () => validateApiKeyFormat(provider, value));
  }
  if (provider === "Apollo") return testApolloKey(value);
  if (provider === "Seamless") return testSeamlessKey(value);
  if (provider === "Apify") return testApifyKey(value);
  if (isLiveLlmKeyProvider(provider)) return testLlmApiKey(provider, value);
  return validateApiKeyFormat(provider, value);
}

/**
 * Test an API key. Either test a value passed directly (just-entered), or test a
 * stored key by id — the secret is read server-side via the service-role client
 * (workspace-scoped), validated, and the row's status is updated. Never returns
 * the secret. LLM vault providers (Anthropic/OpenAI/Groq/xAI/Mistral/Kimi) and
 * sourcing connectors get a live upstream auth probe; others stay format-only.
 */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  let session: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    session = await getServerSupabase();
    if (!session) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const admin = await requireAdmin(session);
    if (!admin.ok) return admin.response;
  }

  const limit = checkRateLimit(rateLimitKey(req, "keys-test"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, ApiKeyTestSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  const { provider, value, id } = validated.data;

  if (value) {
    const result = await resolveKeyTest(provider ?? "", value);
    return NextResponse.json({ ok: true, valid: result.valid, detail: result.detail });
  }

  if (!id) return NextResponse.json({ ok: false, error: "Provide a key value or id." }, { status: 400 });

  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, valid: true, detail: "Simulated test (demo mode)." });
  }
  const svc = getServiceSupabase();
  if (!session || !svc) {
    return NextResponse.json({ ok: false, error: "Service role not configured." }, { status: 500 });
  }

  const { data: wid } = await session.rpc("current_workspace_id");

  const { data: row, error } = await svc
    .from("api_keys")
    .select("provider, secret, workspace_id")
    .eq("id", id)
    .single();
  if (error || !row) return NextResponse.json({ ok: false, error: "Key not found." }, { status: 404 });
  if (row.workspace_id !== wid) return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });

  const secret = decryptSecret(row.secret);
  const fmt = await resolveKeyTest(row.provider, secret);
  await svc
    .from("api_keys")
    .update({ status: fmt.valid ? "valid" : "invalid", last_tested_at: new Date().toISOString() })
    .eq("id", id);
  return NextResponse.json({ ok: true, valid: fmt.valid, detail: fmt.detail });
}
