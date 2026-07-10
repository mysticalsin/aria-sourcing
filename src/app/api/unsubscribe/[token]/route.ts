import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { hashEmailUnsubscribeToken, isEmailUnsubscribeToken } from "@/lib/email-unsubscribe";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

function genericSuccess() {
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

/** A browser visit shows the confirmation page. GET never changes preferences. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(`/unsubscribe/${encodeURIComponent(token)}`, req.url);
  const response = NextResponse.redirect(url, 303);
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}

/** RFC 8058 one-click endpoint. It accepts no recipient identity from callers. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isEmailUnsubscribeToken(token)) return genericSuccess();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return genericSuccess();
  }
  if (form.get("List-Unsubscribe") !== "One-Click") return genericSuccess();

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE_HEADERS });
  }
  const tokenHash = hashEmailUnsubscribeToken(token);
  const { data: ledger, error: ledgerErr } = await supabase
    .from("outreach_ledger")
    .select("workspace_id, candidate_email")
    .eq("email_unsubscribe_token_hash", tokenHash)
    .maybeSingle();
  if (ledgerErr) {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE_HEADERS });
  }
  // Unknown/expired tokens deliberately receive the same success response as a
  // processed request so the endpoint cannot be used to enumerate recipients.
  if (!ledger) return genericSuccess();

  const recipient = String(ledger.candidate_email ?? "").trim().toLowerCase();
  if (!recipient) return genericSuccess();
  const { error: suppressErr } = await supabase.from("suppression_list").upsert(
    {
      workspace_id: ledger.workspace_id,
      type: "email",
      value: recipient,
      reason: "Recipient used the email unsubscribe link.",
      source: "Email List-Unsubscribe",
      expires_at: null,
    },
    { onConflict: "workspace_id,type,value" },
  );
  if (suppressErr) {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE_HEADERS });
  }
  return genericSuccess();
}
