/** Prefer the signed-in session workspace. Settings is only the fallback. */
export function linkedInTokenWorkspaceId(
  session: { workspaceId?: unknown } | null | undefined,
  settingsWorkspaceId?: unknown,
): string | null {
  const fromSession = typeof session?.workspaceId === "string" ? session.workspaceId.trim() : "";
  if (fromSession) return fromSession;
  const fromSettings = typeof settingsWorkspaceId === "string" ? settingsWorkspaceId.trim() : "";
  return fromSettings || null;
}
