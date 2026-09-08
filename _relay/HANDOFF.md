---
project: MSourcing / ARIA
shift: 114
agent: cursor-cloud
updated: 2026-09-08T21:52Z
status: llm-wiki-java-sourcing-green
---

# Handoff — Shift 114

## Current state

- **Branch:** `cursor/llm-wiki-brain-java-sourcing-b91d`
- **Base:** `integration/sourcing-enrichment-on-main` (same as PR #74)
- **Feature:** Durable LLM wiki brain on disk (`ARIA_WIKI_DIR` / `data/llm-wiki`) — not Supabase; Senior Java Developer sourcing demo
- **Prove script:** `npx tsx scripts/prove-llm-wiki-java-sourcing.mjs` → **8 profiles**
- **Tests:** `npx tsc --noEmit` green; `npx tsx tests/knowledge-plane.mts` → 13/13
- **UI demo:** Next on `:3010` with demo login; wiki seeded for `camp_seed_backend`; `/api/source` returned 5 GitHub users; strategy tab showed LLM wiki + enabled **Source next batch**
- **Evidence:** `_relay/evidence/2026-09-08-llm-wiki-java-sourcing.json`, `…-summary.json`, `…-ui.png`, `…-ui.json`

## Done this shift

1. `FileWikiKnowledgePlane` + `seedJavaDeveloperWiki` in `src/lib/knowledge-plane.ts`
2. `GET/POST /api/knowledge/campaign` (seed=java); `CampaignWikiPanel` on campaign strategy tab
3. Seed: `camp_seed_backend` = Senior Java Developer, status **Sourcing**; `STATE_VERSION` 21 + migration patches prior blobs
4. Demo store allows `provenance: "live"` persistence without Supabase
5. Prove script + knowledge-plane tests; `.gitignore` `/data/llm-wiki/`
6. Live UI proof on `:3010` (prod `next start`; Secure cookie remapped for HTTP Playwright)

## Blockers

1. None for this feature. Turbopack `next dev` in this environment failed client hydration (HMR WS); use `next start` or webpack carefully for UI proofs.

## Next steps

1. Merge PR into `integration/sourcing-enrichment-on-main` after review
2. Optional: set `ARIA_WIKI_DIR` on Fly if operators want durable wiki outside container ephemeral disk
3. Do not treat wiki recall as contact permission — lease remains sole lock

## Decisions made (don't relitigate)

- Brain store = markdown wiki on disk, never Supabase
- Wiki is recall-only; `grantsContactClaim` always false
- Java seed campaign status = Sourcing so `campaignAllowsLiveSourcing` enables Source UI
- Demo may persist live GitHub provenance locally

## Watch out

- Do not commit `.env.local` or secrets
- Route handlers must not export helpers (Next App Route constraint) — keep `mapKind` out of `route.ts`
- `knowledge-plane.ts` uses `fs` — server-only; UI must fetch `/api/knowledge/campaign`
