import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { loadSourcingLoopControls } from "@/lib/sourcing-loop-controls";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  return secret !== ""
    && presentedBuf.length === expectedBuf.length
    && timingSafeEqual(presentedBuf, expectedBuf);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  if (req.headers.get("cookie") || req.headers.get("origin")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const workspaceId = (req.headers.get("x-aria-workspace-id") ?? "").trim();
  if (!UUID_RE.test(workspaceId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  if (!supabase) return NextResponse.json({ ok: false, reason: "No service client." }, { status: 503 });

  const loaded = await loadSourcingLoopControls(supabase, workspaceId);
  if (
    !loaded.ok ||
    loaded.row.kill_switch !== false ||
    loaded.row.intake_enabled !== true
  ) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  // Hiring-need intake is webhook → requisition_parse (no empty email_sync).
  // Ignite only verifies the loop is armed for this workspace.
  return NextResponse.json({
    ok: true,
    armed: true,
    intake: "webhook",
    detail: "Sourcing loop armed. Hiring needs arrive via Outlook Graph webhook → requisition_parse.",
    day: todayKey(),
  });
}
