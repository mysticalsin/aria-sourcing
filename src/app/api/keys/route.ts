import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { last4Of, validateApiKeyFormat } from "@/lib/providers";

/**
 * API key storage. Secrets are written to the `api_keys` table (admin-only via
 * RLS) and NEVER returned to the browser. In DEMO mode nothing persists
 * server-side — the response carries only metadata (last4) for the session.
 */
export async function POST(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > 8000) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const name = String(payload.name ?? "").trim();
  const provider = String(payload.provider ?? "").trim();
  const value = String(payload.value ?? "");
  if (!name || !provider || !value) {
    return NextResponse.json({ ok: false, error: "name, provider and value are required." }, { status: 400 });
  }
  if (value.length > 1000) {
    return NextResponse.json({ ok: false, error: "Key too long." }, { status: 413 });
  }

  const last4 = last4Of(value);
  const fmt = validateApiKeyFormat(provider, value);

  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      demo: true,
      last4,
      formatValid: fmt.valid,
      detail: "Saved for this session (demo). Configure Supabase to persist server-side.",
    });
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });

  const { data: wid } = await supabase.rpc("ensure_workspace");
  const { error } = await supabase
    .from("api_keys")
    .insert({ workspace_id: wid, name, provider, secret: value, last4, created_by: user.email });
  if (error) {
    // RLS rejects non-admins.
    return NextResponse.json({ ok: false, error: `Save failed (admins only): ${error.message}` }, { status: 403 });
  }
  return NextResponse.json({ ok: true, last4, formatValid: fmt.valid });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });
  if (!supabaseEnabled) return NextResponse.json({ ok: true, demo: true });
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  const { error } = await supabase.from("api_keys").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
