import type { Role } from "./types";

/* ============================================================================
   Role-based access control.
   admin  — full control (settings, API keys, roles, fleet, all operations)
   member — operates the pipeline (source, outreach, book, replies, skills,
            compliance actions) but cannot manage settings/keys/roles/fleet
   viewer — read-only
   ========================================================================== */

export const PERMISSIONS = [
  "view",
  "source",
  "outreach",
  "book",
  "reply",
  "skills",
  "compliance",
  "manage_fleet",
  "manage_settings",
  "manage_keys",
  "manage_roles",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMS: Record<Role, Permission[]> = {
  admin: [...PERMISSIONS],
  member: ["view", "source", "outreach", "book", "reply", "skills", "compliance"],
  viewer: ["view"],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMS[role]?.includes(perm) ?? false;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: "Full control — settings, API keys, roles, fleet, and every operation.",
  member: "Operates the pipeline: source, outreach, booking, replies, skills. No settings/keys/roles/fleet.",
  viewer: "Read-only — can see everything, change nothing.",
};
