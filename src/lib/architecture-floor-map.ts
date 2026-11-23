/* ============================================================================
   ARIA-A11 architecture floor map.

   Checked-in source only. Rooms cite paths that exist in this tree. The page
   at /floor-map renders this module and nothing else, so the picture cannot
   drift into a second, hand-maintained list. Synthetic demo state is the only
   data class. This module does not import server clients, provider SDKs, or
   the LinkedIn channel.
   ========================================================================== */

export const FLOOR_ZONES = [
  { id: "ingress", title: "Ingress", detail: "Pages and the synthetic demo workspace" },
  { id: "policy", title: "Policy", detail: "Who may act, and what demo mode may not do" },
  { id: "domain", title: "Domain", detail: "Rules, agent proposals, and the one sourcing effect" },
  { id: "delivery", title: "Delivery", detail: "Human approval, then a policy-gated send" },
  { id: "authority", title: "Authority", detail: "Live workspace and ordered schema" },
  { id: "runtime", title: "Runtime", detail: "Fly services described by the checked-in topology" },
] as const;

export type FloorZoneId = (typeof FLOOR_ZONES)[number]["id"];

export type FloorSideEffect = "none" | "demo-blocked" | "policy-gated";

export interface FloorRoom {
  id: string;
  zone: FloorZoneId;
  title: string;
  summary: string;
  paths: readonly string[];
  sideEffect: FloorSideEffect;
  /** Assisted-manual channel. The floor draws no connect flow. */
  assistedManual?: boolean;
}

export interface FloorEdge {
  from: string;
  to: string;
  label: string;
}

export interface ArchitectureFloorMap {
  id: "aria-a11";
  describes: "checked-in-source";
  dataClass: "synthetic";
  sourceGuide: "docs/ARCHITECTURE.md";
  rooms: readonly FloorRoom[];
  edges: readonly FloorEdge[];
  /** Boundaries this floor refuses to draw. Labels only — not procedures. */
  prohibited: readonly string[];
}

export const ARCHITECTURE_FLOOR_MAP: ArchitectureFloorMap = {
  id: "aria-a11",
  describes: "checked-in-source",
  dataClass: "synthetic",
  sourceGuide: "docs/ARCHITECTURE.md",
  prohibited: [
    "session automation",
    "profile harvesting",
    "Voyager",
    "cookie capture",
    "rate-limit bypass",
  ],
  rooms: [
    {
      id: "browser",
      zone: "ingress",
      title: "Browser",
      summary: "Next.js pages and route handlers. They collect a request and do not own authority.",
      paths: ["src/app"],
      sideEffect: "none",
    },
    {
      id: "demo-store",
      zone: "ingress",
      title: "Synthetic demo",
      summary: "Browser state seeded from the synthetic workspace. Dry-run only.",
      paths: ["src/lib/seed.ts", "src/lib/store.ts"],
      sideEffect: "demo-blocked",
    },
    {
      id: "principal",
      zone: "policy",
      title: "Authenticated principal",
      summary: "Live routes take identity from the authenticated principal and role policy, not from browser state.",
      paths: ["src/lib/server/authenticated-principal.ts"],
      sideEffect: "policy-gated",
    },
    {
      id: "demo-block",
      zone: "policy",
      title: "Demo side-effect block",
      summary: "Server policy blocks production side effects while the workspace is the synthetic demo.",
      paths: ["src/lib/server/demo-side-effects.ts"],
      sideEffect: "demo-blocked",
    },
    {
      id: "domain",
      zone: "domain",
      title: "Domain policy",
      summary: "Recruiting rules live in src/lib. Provider credentials stay out of client bundles.",
      paths: ["src/lib"],
      sideEffect: "none",
    },
    {
      id: "agent-run",
      zone: "domain",
      title: "Agent run",
      summary: "A run returns a proposal. Framework output cannot create candidates or send messages.",
      paths: ["src/app/api/agents/specs/route.ts", "src/app/api/agents/run/route.ts"],
      sideEffect: "policy-gated",
    },
    {
      id: "sourcing",
      zone: "domain",
      title: "Sourcing effect",
      summary: "One production sourcing path rechecks authority, then stages a content-bound result.",
      paths: ["src/app/api/sourcing-agent/route.ts"],
      sideEffect: "policy-gated",
    },
    {
      id: "approval",
      zone: "delivery",
      title: "Exact-text approval",
      summary: "A human approval is bound to the exact message body before any live send.",
      paths: ["src/lib/outreach-approval.ts"],
      sideEffect: "policy-gated",
    },
    {
      id: "dispatch",
      zone: "delivery",
      title: "Dispatch",
      summary: "Email delivery goes through the send route and durable dispatch. Unknown outcomes stay non-retryable.",
      paths: ["src/app/api/outreach/send/route.ts", "src/lib/dispatch-outbound.ts"],
      sideEffect: "policy-gated",
    },
    {
      id: "linkedin-assisted",
      zone: "delivery",
      title: "Assisted-manual channel",
      summary: "The channel stays assisted-manual. This floor does not draw a connect flow.",
      paths: ["src/lib/linkedin-policy.ts"],
      sideEffect: "none",
      assistedManual: true,
    },
    {
      id: "whatsapp",
      zone: "delivery",
      title: "WhatsApp",
      summary: "Sender, consent, template or reply-window, review, and signed webhook checks gate this channel.",
      paths: ["src/lib/whatsapp-policy.ts"],
      sideEffect: "policy-gated",
    },
    {
      id: "suppression",
      zone: "delivery",
      title: "Suppression",
      summary: "Suppression and consent are normalized policy, not a browser flag.",
      paths: ["src/lib/manual-suppression.ts"],
      sideEffect: "policy-gated",
    },
    {
      id: "supabase",
      zone: "authority",
      title: "Live workspace",
      summary: "Supabase configuration and clients. Shared browser state cannot select a tenant or a secret.",
      paths: ["src/lib/supabase"],
      sideEffect: "policy-gated",
    },
    {
      id: "migrations",
      zone: "authority",
      title: "Schema",
      summary: "Ordered migrations are the authority source. Apply them in order, including the intentional gap.",
      paths: ["supabase/migrations"],
      sideEffect: "policy-gated",
    },
    {
      id: "fly-app",
      zone: "runtime",
      title: "App",
      summary: "Public application service.",
      paths: ["fly.app.toml"],
      sideEffect: "none",
    },
    {
      id: "fly-kong",
      zone: "runtime",
      title: "Kong",
      summary: "Gateway in front of auth and REST.",
      paths: ["fly.kong.toml"],
      sideEffect: "none",
    },
    {
      id: "fly-auth",
      zone: "runtime",
      title: "Auth",
      summary: "Pinned auth image behind Kong.",
      paths: ["fly.auth.toml"],
      sideEffect: "none",
    },
    {
      id: "fly-rest",
      zone: "runtime",
      title: "REST",
      summary: "Pinned REST image behind Kong.",
      paths: ["fly.rest.toml"],
      sideEffect: "none",
    },
    {
      id: "fly-db",
      zone: "runtime",
      title: "Database",
      summary: "Database service. Postgres remains the live authority store.",
      paths: ["fly.db.toml"],
      sideEffect: "none",
    },
    {
      id: "fly-bootstrap",
      zone: "runtime",
      title: "Bootstrap",
      summary: "One-shot reconciliation and ordered migrations. It exits after evidence is recorded.",
      paths: ["fly.bootstrap.toml"],
      sideEffect: "policy-gated",
    },
  ],
  edges: [
    { from: "browser", to: "principal", label: "page or route handler" },
    { from: "principal", to: "domain", label: "role policy" },
    { from: "domain", to: "supabase", label: "live workspace" },
    { from: "demo-store", to: "demo-block", label: "dry-run only" },
    { from: "agent-run", to: "sourcing", label: "proposal, then one effect path" },
    { from: "approval", to: "dispatch", label: "exact message body" },
    { from: "dispatch", to: "suppression", label: "consent still applies" },
    { from: "supabase", to: "migrations", label: "normalized tables" },
    { from: "fly-app", to: "fly-kong", label: "internet entry" },
    { from: "fly-kong", to: "fly-auth", label: "auth" },
    { from: "fly-kong", to: "fly-rest", label: "rest" },
    { from: "fly-rest", to: "fly-db", label: "postgres" },
  ],
};

const REQUIRED_ROOMS = [
  "browser",
  "demo-store",
  "principal",
  "demo-block",
  "domain",
  "agent-run",
  "sourcing",
  "approval",
  "dispatch",
  "linkedin-assisted",
  "whatsapp",
  "suppression",
  "supabase",
  "migrations",
  "fly-app",
  "fly-kong",
  "fly-auth",
  "fly-rest",
  "fly-db",
  "fly-bootstrap",
] as const;

const REQUIRED_PROHIBITED = [
  "session automation",
  "profile harvesting",
  "Voyager",
  "cookie capture",
  "rate-limit bypass",
] as const;

function isSafeRelativePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("..") && !path.includes("\\") && !path.includes("\0");
}

/** Returns human-readable drift. Empty means the map still matches its contract. */
export function floorMapDrift(map: ArchitectureFloorMap, exists: (path: string) => boolean): string[] {
  const issues: string[] = [];
  if (map.id !== "aria-a11" || map.describes !== "checked-in-source" || map.dataClass !== "synthetic") {
    issues.push("map identity must stay aria-a11, checked-in source, synthetic");
  }
  if (map.sourceGuide !== "docs/ARCHITECTURE.md") issues.push("source guide drifted");
  if (!exists(map.sourceGuide)) issues.push("architecture guide is missing");

  const ids = new Set<string>();
  const zones = new Set(FLOOR_ZONES.map((zone) => zone.id));
  for (const room of map.rooms) {
    if (ids.has(room.id)) issues.push(`duplicate room ${room.id}`);
    ids.add(room.id);
    if (!zones.has(room.zone)) issues.push(`room ${room.id} has an unknown zone`);
    if (room.paths.length === 0) issues.push(`room ${room.id} cites no path`);
    for (const path of room.paths) {
      if (!isSafeRelativePath(path)) issues.push(`room ${room.id} has an unsafe path`);
      else if (!exists(path)) issues.push(`missing path for ${room.id}: ${path}`);
    }
  }

  for (const id of REQUIRED_ROOMS) {
    if (!ids.has(id)) issues.push(`required room missing: ${id}`);
  }
  for (const zone of FLOOR_ZONES) {
    if (!map.rooms.some((room) => room.zone === zone.id)) issues.push(`zone ${zone.id} is empty`);
  }

  for (const edge of map.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) issues.push(`edge leaves the map: ${edge.from} -> ${edge.to}`);
    if (edge.label.trim().length === 0) issues.push(`edge ${edge.from} -> ${edge.to} has no label`);
  }

  const assisted = map.rooms.find((room) => room.id === "linkedin-assisted");
  if (!assisted?.assistedManual || assisted.sideEffect !== "none") {
    issues.push("assisted-manual room must stay manual and side-effect free");
  }
  if (map.edges.some((edge) => edge.from === "linkedin-assisted" || edge.to === "linkedin-assisted")) {
    issues.push("assisted-manual room must not be wired into a send path");
  }

  for (const label of REQUIRED_PROHIBITED) {
    if (!map.prohibited.includes(label)) issues.push(`prohibited boundary missing: ${label}`);
  }

  const narrative = [...map.rooms.map((room) => `${room.title} ${room.summary}`), ...map.edges.map((edge) => edge.label)].join("\n");
  if (/@/.test(narrative) || /sk-|api[_-]?key|password\s*[:=]|BEGIN PRIVATE/i.test(narrative)) {
    issues.push("map narrative contains a credential or address");
  }

  return issues;
}
