export interface AuthenticatedPrincipal {
  id: string;
  kind: "supabase" | "signed-demo";
}

export function principalFromEvidence(input: {
  supabaseUserId: string | null;
  signedDemoSession: boolean;
}): AuthenticatedPrincipal | null {
  if (input.supabaseUserId) {
    return { id: `user:${input.supabaseUserId}`, kind: "supabase" };
  }
  if (input.signedDemoSession) {
    return { id: "demo:signed-session", kind: "signed-demo" };
  }
  return null;
}
