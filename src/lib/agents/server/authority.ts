/* ============================================================================
   Who may drive the agents, and for whom (ADR 0002).

   - The runner container authenticates with AGENT_RUNNER_SECRET (Bearer,
     constant-time compare), shared only by the app and agents services.
     Agents are off unless AGENTS_ENABLED=true.
   - It never acts for itself: every action is on behalf of a user who
     granted a delegation (agent_delegations, revocable) and who still holds
     the role the action needs in that workspace.
   ========================================================================== */

import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { can, type Permission } from "@/lib/rbac";
import type { Role } from "@/lib/types";

export type Svc = NonNullable<ReturnType<typeof getServiceSupabase>>;
export type AgentScope = "source" | "draft" | "queue_linkedin" | "send_email";

export function agentsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTS_ENABLED === "true" && (env.AGENT_RUNNER_SECRET ?? "").length >= 32;
}

/** The runner's bearer, compared in constant time. */
export function runnerAuthorized(req: Pick<NextRequest, "headers">, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.AGENT_RUNNER_SECRET ?? "";
  if (!agentsEnabled(env)) return false;
  const presented = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export function serviceClient(): Svc | null {
  return supabaseEnabled ? getServiceSupabase() : null;
}

const SCOPE_PERMISSION: Record<AgentScope, Permission> = {
  source: "source",
  draft: "outreach",
  queue_linkedin: "outreach",
  send_email: "outreach",
};

export interface OwnerAuthority {
  ok: boolean;
  reason?: string;
  name: string;
}

/**
 * The delegating user still allows the agents (`scope` granted, not revoked),
 * still belongs to the workspace, and still holds the matching permission.
 */
export async function ownerAuthority(svc: Svc, workspaceId: string, userId: string, scope: AgentScope): Promise<OwnerAuthority> {
  const [delegation, profile] = await Promise.all([
    svc.from("agent_delegations").select("scopes, revoked_at").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
    svc.from("profiles").select("workspace_id, role, full_name, email").eq("id", userId).maybeSingle(),
  ]);
  const name = String(profile.data?.full_name || profile.data?.email || "the campaign owner");
  if (delegation.error || profile.error) return { ok: false, reason: "Authority unavailable.", name };
  if (!delegation.data || delegation.data.revoked_at !== null) return { ok: false, reason: "The owner revoked the agents.", name };
  if (!Array.isArray(delegation.data.scopes) || !delegation.data.scopes.includes(scope)) return { ok: false, reason: `The owner did not allow "${scope}".`, name };
  if (!profile.data || profile.data.workspace_id !== workspaceId) return { ok: false, reason: "The owner left this workspace.", name };
  if (!can(profile.data.role as Role, SCOPE_PERMISSION[scope])) return { ok: false, reason: "The owner's role no longer allows this.", name };
  return { ok: true, name };
}
