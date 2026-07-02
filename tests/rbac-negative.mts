import { can, PERMISSIONS } from "../src/lib/rbac";
import type { Role } from "../src/lib/types";

/* ============================================================================
   tests/rbac-negative.mts
   RBAC negative-space coverage: what a role must NEVER be granted.

   rbac-keys.mts already spot-checks a handful of allow/deny pairs; this file
   is exhaustive over every mutating permission for `viewer`, and separately
   proves unknown/anonymous roles default-deny across the board (the failure
   mode that actually matters: a typo'd or missing role must never silently
   grant access).
   ========================================================================== */

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- viewer: every mutating permission must be denied ---------------------
   "view" is the only permission viewer holds; every other permission (source,
   outreach, book, reply, skills, compliance, manage_fleet, manage_settings,
   manage_keys, manage_roles, manage_providers, manage_models, manage_tools)
   maps directly onto real write endpoints (outreach send, fleet seat mgmt,
   skills mutation, API key storage, tool/MCP config) and must stay denied. */
const MUTATING_PERMS = PERMISSIONS.filter((p) => p !== "view");
for (const perm of MUTATING_PERMS) {
  ok(`viewer CANNOT ${perm}`, !can("viewer", perm));
}
ok("viewer retains view", can("viewer", "view"));

/* ---- member: admin-only permissions must stay denied ----------------------
   member operates the pipeline (source/outreach/book/reply/skills/compliance)
   but must never manage fleet, settings, keys, roles, providers, models, or
   tools — those are exactly the admin-gated endpoints (e.g. /api/mcp/test's
   manage_tools check, /api/keys admin guard). */
const MEMBER_DENIED: (typeof PERMISSIONS)[number][] = [
  "manage_fleet",
  "manage_settings",
  "manage_keys",
  "manage_roles",
  "manage_providers",
  "manage_models",
  "manage_tools",
];
for (const perm of MEMBER_DENIED) {
  ok(`member CANNOT ${perm}`, !can("member", perm));
}
const MEMBER_ALLOWED: (typeof PERMISSIONS)[number][] = [
  "view",
  "source",
  "outreach",
  "book",
  "reply",
  "skills",
  "compliance",
];
for (const perm of MEMBER_ALLOWED) {
  ok(`member CAN ${perm}`, can("member", perm));
}

/* ---- unknown / anonymous roles default-deny --------------------------------
   `can()` does `ROLE_PERMS[role]?.includes(perm) ?? false` — a role string
   that never resolves a permission array must fall through to `false`, not
   throw or coerce to a truthy default. This is the failure mode a typo'd
   role, an unmigrated legacy role, or a missing profile row would trigger. */
const UNKNOWN_ROLES = ["superadmin", "guest", "", "ADMIN", "Viewer", "null", "undefined"];
for (const role of UNKNOWN_ROLES) {
  for (const perm of PERMISSIONS) {
    ok(`unknown role "${role}" CANNOT ${perm}`, !can(role as Role, perm));
  }
}

/* Explicit null/undefined role (e.g. a caller_role RPC that returned nothing)
   must default-deny too, not throw. */
ok("undefined role CANNOT view", !can(undefined as unknown as Role, "view"));
ok("null role CANNOT view", !can(null as unknown as Role, "view"));
ok("undefined role CANNOT manage_keys", !can(undefined as unknown as Role, "manage_keys"));

/* ---- admin sanity (positive control — proves the harness isn't just always-false) */
ok("admin CAN manage_tools (positive control)", can("admin", "manage_tools"));
ok("admin CAN outreach (positive control)", can("admin", "outreach"));

console.log(`RESULT rbac-negative: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
