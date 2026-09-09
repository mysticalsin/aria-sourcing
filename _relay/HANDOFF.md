---
project: MSourcing / ARIA
shift: 116
agent: cursor-cloud
updated: 2026-09-09T06:40Z
status: campaign-agents-vm-take-control-e2e-green
---

# Handoff — Shift 116

## Current state

- **Branch:** `cursor/campaign-agent-vm-control-b91d` (from llm-wiki / LinkedIn-first)
- **Base for PR:** `integration/sourcing-enrichment-on-main`
- **Feature:** Campaign page **Agents** tab lists LinkedIn Browser Computer seats assigned to that campaign; Start VM / Observe / Take control / Release with live Chromium iframe + audits
- **Seed:** `seat_java_vm_01..03` → `comp_java_01..03` assigned to `camp_seed_backend` (`STATE_VERSION` 23)
- **E2E video:** `/opt/cursor/artifacts/aria-campaign-agents-vm-take-control.mp4`
- **Evidence:** `_relay/evidence/2026-09-09-campaign-agents-*.png` + `...-vm-e2e.json`
- **CSP:** `frame-src` allows OpenBot supervisor origins so Observe iframe is not blank
- **Start warmup:** successful OpenBot ensure navigates Chromium to LinkedIn

## Done this shift

1. `AgentSeat.assignedCampaignIds` + seed/migration for three Java campaign VMs
2. `CampaignAgentsPanel` + Agents tab on `campaigns/[id]`
3. CSP `frame-src` for live viewport embeds; LinkedIn warmup on computer start
4. Hardened recorder `scripts/record-campaign-agents-vm-e2e.mjs` (frees supervisor slots; asserts Human control / Release)
5. End-to-end proven: Agents tab → Start → Observe (live view) → Take control → Release

## Blockers

1. Local OpenBot supervisor max=10 — E2E frees non-`comp_java_*` slots first; Fleet seats can starve campaign VMs if all 10 are held
2. `npm test` still has 7 failing `store-sourcing-actions` cases on this lineage (80% quality floor / LinkedIn-first) — **not introduced by this campaign-VM diff**; `tsc` + `tests/computer-supervisor.mts` green

## Next steps

1. Open/merge PR for `cursor/campaign-agent-vm-control-b91d`
2. Optional: proxy `/view` same-origin instead of broad `frame-src https:`
3. Optional: stop idle Fleet computers from campaign UI when max capacity blocks Start
4. Keep wiki recall ≠ contact lease; production Fly only for OpenBot path

## Decisions made (don't relitigate)

- Brain = LLM wiki on disk, not Supabase
- Software sourcing is LinkedIn-first; GitHub secondary
- Wiki never grants contact claims
- 1 seat = 1 Chromium VM; Take-controllable; campaign Agents tab scopes Fleet computers to `assignedCampaignIds`
- Production = Fly for this path; never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on prod

## Watch out

- Do not commit `.env.local` / tokens / Tavily keys
- Prefer `node .next/standalone/server.js` (or ensure CSP from fresh build) — stale `next start` can serve old headers with `output: standalone`
- Turbopack `next dev` hydration flaky — use production server for UI proofs
- Playwright full-page screenshots mid-recording can flash gray; use viewport screenshots
