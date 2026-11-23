import { NextResponse } from "next/server";
import { prodFailClosed } from "@/lib/supabase/config";
import { publicConnectStatus } from "@/lib/linkedin-rsc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connection state only. The bearer token is never copied into the response. */
export async function GET() {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  return NextResponse.json(publicConnectStatus(), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
