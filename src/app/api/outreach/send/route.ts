import { NextResponse, type NextRequest } from "next/server";
import { sendViaProvider, type SendRequest } from "@/lib/providers";

/**
 * Outreach send endpoint. Dry-run by DEFAULT and always when `confirmLive` is not
 * explicitly true — nothing leaves the building unless the caller opts in AND a
 * provider key is configured server-side. Email only; no LinkedIn automation.
 */
export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ status: "error", detail: "Invalid JSON body." }, { status: 400 });
  }

  const provider = payload.provider as SendRequest["provider"];
  const from = String(payload.from ?? "");
  const to = String(payload.to ?? "");
  const subject = String(payload.subject ?? "");
  const body = String(payload.body ?? "");
  const fromName = payload.fromName ? String(payload.fromName) : undefined;
  const confirmLive = payload.confirmLive === true;

  if (!provider || !from || !to || !subject || !body) {
    return NextResponse.json({ status: "error", detail: "Missing required fields." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ status: "error", detail: "Invalid recipient address." }, { status: 400 });
  }

  // Global safety default: never send unless explicitly confirmed live.
  if (!confirmLive) {
    return NextResponse.json({
      status: "dry-run",
      provider,
      detail: "Dry-run — confirmLive not set. Nothing was sent.",
    });
  }

  try {
    const outcome = await sendViaProvider({ provider, from, fromName, to, subject, body });
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json(
      { status: "error", provider, detail: err instanceof Error ? err.message : "Send failed." },
      { status: 500 },
    );
  }
}
