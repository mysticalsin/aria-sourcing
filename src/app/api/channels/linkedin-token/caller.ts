import { cookies } from "next/headers";

import { supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";

export const LINKEDIN_TOKEN_TEST_WORKSPACE = "synthetic-workspace";

export function linkedInTokenTestSessionOpen(): boolean {
  // The dev bundler rewrites a direct NODE_ENV read, so the key is built at runtime.
  const env = process["env"] as Record<string, string | undefined>;
  const NODE_ENV = env[["NODE", "ENV"].join("_")];
  return NODE_ENV === "test" && process.env.ARIA_LINKEDIN_TOKEN_TEST_SESSION === "1";
}

export async function linkedInTokenCaller(): Promise<{ userId: string | null; role: string; workspaceId: string | null }> {
  if (linkedInTokenTestSessionOpen()) {
    const jar = await cookies();
    const role = jar.get("aria_e2e_role")?.value;
    if (role === "admin" || role === "owner" || role === "member" || role === "viewer") {
      return { userId: "e2e-user", role, workspaceId: LINKEDIN_TOKEN_TEST_WORKSPACE };
    }
    return { userId: null, role: "", workspaceId: null };
  }
  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) return { userId: null, role: "", workspaceId: null };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { userId: null, role: "", workspaceId: null };
    const { data: role } = await supabase.rpc("current_profile_role");
    const name = role === "admin" || role === "owner" || role === "viewer" || role === "member" ? role : "";
    if (!name) return { userId: user.id, role: "", workspaceId: null };
    const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", user.id).maybeSingle();
    const workspaceId = typeof profile?.workspace_id === "string" ? profile.workspace_id : null;
    if (!workspaceId) return { userId: null, role: "", workspaceId: null };
    return { userId: user.id, role: name, workspaceId };
  }
  return { userId: null, role: "", workspaceId: null };
}
