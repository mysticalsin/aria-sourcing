# Rename leftover "hermes" identifiers

Status: resolved

The Hermes runtime is gone, but the name remains in the package name
(`hermes-sourcing`), `/api/hermes/chat` (now the generic cloud LLM route),
`src/lib/ai/hermes.ts`, `HermesState` / `HermesActions` types, the seeded
`admin@hermes.local` user and "Hermes Workspace". Cosmetic but confusing for
new developers. Rename in small steps with tests; keep state migrations
(`normalizeHermesState`) compatible with persisted workspace documents.

## Resolution (2026-11-03, claude-code, owner request)
- Dead runtime path removed (7cd10cff): hermes* settings, hermesAvailable, the
  chat SSE path, HERMES_ALLOWED_HOSTS, the `hermes` / `hermes-agent` hosts.
- Renamed: WorkspaceState / WorkspaceActions / WorkspaceProvider / useWorkspace,
  `src/lib/ai/generate.ts` (aiGenerate), route `/api/ai/chat`, AriaMark /
  AriaWordmark / AriaLockup, package `aria-sourcing`, demo login
  `admin@aria.local` ("Aria Workspace", domain aria.local).
- Compatibility kept on purpose: browser keys `hermes-sourcing:v1` and
  `hermes:onboarded:v1` are still read (the workspace key is removed on the
  next save); saved settings drop the hermes* fields on load; the Docker
  bootstrap renames an existing `admin@hermes.local` account in place.
