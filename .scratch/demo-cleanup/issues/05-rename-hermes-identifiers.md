# Rename leftover "hermes" identifiers

Status: needs-triage

The Hermes runtime is gone, but the name remains in the package name
(`hermes-sourcing`), `/api/hermes/chat` (now the generic cloud LLM route),
`src/lib/ai/hermes.ts`, `HermesState` / `HermesActions` types, the seeded
`admin@hermes.local` user and "Hermes Workspace". Cosmetic but confusing for
new developers. Rename in small steps with tests; keep state migrations
(`normalizeHermesState`) compatible with persisted workspace documents.
