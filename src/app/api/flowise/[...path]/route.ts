import { NextResponse } from "next/server";
import { prodFailClosed } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Browser-to-Flowise proxying is intentionally disabled. A caller-controlled
 * flow ID is not tenant authority, and arbitrary Flowise request bodies can
 * carry session overrides or invoke graph capabilities ARIA never approved.
 *
 * Production framework traffic must use the private, server-owned adapter and
 * an immutable workspace/owner/spec/workflow binding. This route must never
 * forward a browser request or reveal whether an upstream flow exists.
 */
export const FLOWISE_PUBLIC_PROXY_DISABLED =
  "Flowise execution is available only through the private ARIA framework adapter.";

async function disabled() {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  return NextResponse.json(
    { ok: false, code: "flowise_public_proxy_disabled", reason: FLOWISE_PUBLIC_PROXY_DISABLED },
    { status: 503 },
  );
}

export async function GET() {
  return disabled();
}

export async function POST() {
  return disabled();
}

export async function PUT() {
  return disabled();
}

export async function DELETE() {
  return disabled();
}
