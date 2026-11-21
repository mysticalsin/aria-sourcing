import { NextResponse, type NextRequest } from "next/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8_000_000;

function calm(reason: string, status = 200) {
  return NextResponse.json(
    { ok: false, reason },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Demo path into the local ingest service. A live workspace without an
 * explicit ingest URL does not accept a CV here. A missing service is a
 * calm response, not a logged failure.
 */
export async function POST(req: NextRequest) {
  const blocked = prodFailClosed();
  if (blocked) return blocked;
  const target = process.env.ARIA_INGEST_URL ?? "http://127.0.0.1:8091/v1/cv";
  if (supabaseEnabled && !process.env.ARIA_INGEST_URL) return calm("demo-only", 409);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return calm("file", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) return calm("file", 400);
  const outbound = new FormData();
  outbound.set("file", file, file.name || "cv.pdf");
  let response: Response;
  try {
    response = await fetch(target, { method: "POST", body: outbound });
  } catch {
    return calm("ingest-off");
  }
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; name?: string; email?: string } | null;
  if (!response.ok || !payload?.ok || !payload.name || !payload.email) return calm("ingest-off");
  if (!payload.email.toLowerCase().endsWith("@example.test")) return calm("synthetic", 422);
  return NextResponse.json(
    { ok: true, name: payload.name, email: payload.email },
    { headers: { "cache-control": "no-store" } },
  );
}
