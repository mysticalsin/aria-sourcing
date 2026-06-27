import { NextResponse, type NextRequest } from "next/server";
import { parseEmailAndJD, isMantuNeedEmail } from "@/lib/mock-ai";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";

/**
 * Intake API / email-scan endpoint.
 *
 * An inbound email integration (Microsoft Graph subscription, a forwarding rule,
 * n8n, Zapier, …) POSTs a received job-description email here and gets back a
 * structured JobAnalysis + suggested hiring-manager meta. The client then creates
 * the campaign (human-in-the-loop) — parsing never auto-sends or auto-contacts.
 *
 * Body (either shape):
 *   { "email": "<raw email text>", "jd": "<optional JD text>" }
 *   { "from": "...", "subject": "...", "body": "<email body>" }
 *
 * Auth: required when Supabase is configured; open in demo mode (it only parses
 * text the caller supplies — no data access).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST { email, jd? } or { from, subject, body } to parse a JD email into a structured JobAnalysis.",
  });
}

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  // Accept {email,jd} or {from,subject,body}
  const email =
    typeof payload.email === "string" && payload.email.trim()
      ? payload.email
      : [
          payload.from ? `From: ${payload.from}` : "",
          payload.subject ? `Subject: ${payload.subject}` : "",
          typeof payload.body === "string" ? payload.body : "",
        ]
          .filter(Boolean)
          .join("\n");
  const jd = typeof payload.jd === "string" ? payload.jd : undefined;

  if (!email.trim()) {
    return NextResponse.json({ ok: false, error: "Provide `email` (or `from`/`subject`/`body`)." }, { status: 400 });
  }

  // Gate when a real backend exists; open in demo (pure text parsing).
  if (supabaseEnabled) {
    const supabase = getServerSupabase();
    const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (!data?.user) {
      return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    }
  }

  const parsed = parseEmailAndJD({ email, jd });
  return NextResponse.json({
    ok: true,
    format: isMantuNeedEmail(email) ? "mantu-need" : "generic",
    parsed,
    suggestedMeta: {
      hiringManager: parsed.sender.name,
      hiringManagerEmail: parsed.sender.email,
    },
  });
}
