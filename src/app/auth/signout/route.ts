import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

async function handle(req: NextRequest) {
  const supabase = getServerSupabase();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", new URL(req.url).origin));
}

export const GET = handle;
export const POST = handle;
