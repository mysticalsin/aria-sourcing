import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { listLinkedInBrowserAgentStatus } from "@/lib/integrations/linkedin-browser-agents";
import {
  agentReachLinkedInMcpStatus,
  agentReachLinkedInSearchStatus,
  agentReachLinkedInStatus,
} from "@/lib/integrations/agent-reach-linkedin";

export const runtime = "nodejs";

/**
 * Operator doctor for Agent Reach eyes (Jina + optional MCP) and sibling
 * LinkedIn browser-agent capabilities. Never invents connectivity — flags only
 * reflect env configuration. Connect/Message stay on OpenBot seats.
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-agent-reach-status"), {
    windowMs: 60_000,
    max: 60,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  if (supabaseEnabled) {
    const session = await getServerSupabase();
    if (!session) {
      return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    }
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await session.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const jina = agentReachLinkedInStatus();
  const jinaSearch = agentReachLinkedInSearchStatus();
  const mcp = agentReachLinkedInMcpStatus();
  const agents = listLinkedInBrowserAgentStatus();

  return NextResponse.json({
    ok: true,
    role: "eyes",
    hands: "OpenBot Browser Computer (Connect/Message)",
    agentReach: { jina, jinaSearch, mcp },
    agents,
  });
}
