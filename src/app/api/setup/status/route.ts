import { NextResponse } from "next/server";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { secretEncryptionEnabled } from "@/lib/crypto-secrets";
import { resolveAiProvider, VAULT_PROVIDER } from "@/lib/ai/provider";
import { resolveProviderEndpoint } from "@/lib/ai/endpoint";
import { readCurrentReadiness } from "@/lib/server/readiness";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import type { SystemSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const blocked = prodFailClosed();
  if (blocked) return blocked;
  const response = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (!supabaseEnabled) return response({ mode: "synthetic", ready: false, checks: [], message: "Synthetic demo: start the Docker stack to persist real campaigns and candidates." });
  const session = await getServerSupabase();
  const authority = await requireAdmin(session);
  if (!authority.ok) return authority.response;
  if (!session) return response({ error: "Workspace unavailable." }, 503);
  const limit = checkRateLimit(rateLimitKey(req, "setup-status"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);
  try {
    const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
    if (workspaceError || typeof workspaceId !== "string") return response({ error: "Workspace unavailable." }, 503);
    const [health, state, keys, mailboxes] = await Promise.all([
      readCurrentReadiness(),
      session.from("workspace_state").select("state").eq("workspace_id", workspaceId).abortSignal(AbortSignal.timeout(5000)).maybeSingle(),
      session.from("api_keys").select("id,provider,status").eq("workspace_id", workspaceId).abortSignal(AbortSignal.timeout(5000)),
      session.from("email_connections").select("id").eq("workspace_id", workspaceId).limit(1).abortSignal(AbortSignal.timeout(5000)),
    ]);
    if (state.error || keys.error || mailboxes.error) return response({ error: "Could not verify workspace configuration. Retry the check." }, 503);
    const settings = state.data?.state?.settings as SystemSettings | undefined;
    const model = settings ? resolveAiProvider(settings, "sourcing") : null;
    const validKeys = (keys.data ?? []).filter((key) => key.status === "valid");
    let endpointConfigured = Boolean(model?.model);
    if (model?.provider === "local") {
      try { resolveProviderEndpoint(model.provider, model.baseUrl); }
      catch { endpointConfigured = false; }
    }
    const modelKeyConfigured = model && validKeys.some((key) => key.id === model.apiKeyId && key.provider === VAULT_PROVIDER[model.provider]);
    const aiConfigured = Boolean(endpointConfigured && model && (model.provider === "local" && !model.apiKeyId || modelKeyConfigured));
    const encrypted = secretEncryptionEnabled();
    const checks = [
      { id: "session", label: "Sign-in", status: "verified", detail: "Your administrator session is authenticated." },
      { id: "database", label: "Database and migrations", status: health?.ok ? "verified" : "blocked", detail: health?.ok ? "Database, authentication, outbox and migration identity checks passed." : "Backend readiness has not passed. Check the Docker service health and migration logs." },
      { id: "encryption", label: "Credential storage", status: encrypted ? "verified" : "blocked", detail: encrypted ? "An encryption key is loaded. Keep its volume with the database." : "An encryption key is required to save provider keys or mailbox credentials." },
      { id: "ai", label: "AI drafts", status: aiConfigured ? "configured" : "missing", detail: aiConfigured ? "A sourcing model and its required credentials are saved. No model request was made." : "Configure a sourcing model later. Deterministic GitHub sourcing remains available." },
      { id: "linkedin", label: "LinkedIn via Apify", status: validKeys.some((key) => key.provider === "Apify") ? "configured" : "missing", detail: "Requires a saved Apify key. This check does not start a paid search." },
      { id: "web", label: "Web discovery", status: validKeys.some((key) => key.provider === "Tavily") || process.env.TAVILY_API_KEY ? "configured" : "missing", detail: "Requires Tavily for site-scoped discovery. No search request was made." },
      { id: "mailbox", label: "Email and replies", status: mailboxes.data?.length ? "configured" : "missing", detail: "A saved mailbox connection needs a separate send/reply acceptance test." },
    ];
    return response({ mode: "connected", ready: Boolean(health?.ok && encrypted), checks, message: "Verified checks ran against the backend. Configured integrations still need their provider acceptance test." });
  } catch {
    return response({ error: "Workspace checks did not complete. Retry after the backend is healthy." }, 503);
  }
}
