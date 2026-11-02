---
project: MSourcing / ARIA
shift: 449
agent: claude-code
updated: 2026-11-02
status: claude-live-verified-app-replay-next
---

# Handoff - Shift 449

## Current state

- Branch mbe-branch. Gate green at the last commit (typecheck, typecheck:tests,
  npm test exit 0).
- AI layer runs on one Anthropic key + `ANTHROPIC_WORKSPACE_ID` from `.secret`
  (gitignored and dockerignored). Live calls verified 2026-11-02 (issue 01:
  4 tasks, $0.0047). The owner set a spend limit on the workspace.
- UI/UX audit (`.scratch/ui-ux-audit/`): issues 01-10 all `Status: resolved`.
- AI issues (`.scratch/ai-agents/issues/`): 01, 02, 03 resolved; 04 ready-for-agent; 05 ready-for-agent (launch, inbox and
  follow-up missions done); 06, 07, 08 needs-triage.

## Done this shift

AI (owner: "Fais les 5 étapes"):
1. 18919c81 stop reasons: `max_tokens`/`refusal` (and OpenAI `length`/
   `content_filter`) are failures (`cloudStopProblem`), so callers fall back.
2. 7a12ae4a brief extraction on Haiku: task `extract`, `INTAKE_OUTPUT_SCHEMA`
   via `output_config.format`, model default `extraction` (STATE_VERSION 19).
3. 3555b90d spend persisted to `AI_USAGE_FILE` (else /app/config or
   var/ai-usage.json), admin `GET /api/ai/usage`, "Claude usage" card in
   Settings (month/day meters, per-task table).
4. c6998192 follow-up mission: `src/lib/agents/follow-up-mission.ts`, used by
   "Draft all due" on /outreach (3 at a time, best matches first, max 20).

UX audit packages:
- 6f7e0b51 (07) tour on `/` only. 7bd03fba (02) KPIs name their basis, one
  integration count.
- ef1aba2d (05) home: one primary action; replies: stream first; outreach:
  collapsed draft rows + composer drawer (page 14,300 px -> 2,700 px).
- 734c2e40 (06) candidates: one toolbar row, 10 rows at 1440x900, cards and a
  Filters toggle under 640 px, flags beside the name.
- b1665c7a (04) nav regrouped (Home; Recruit; Engage; Analyze; System, 12
  entries, fits 900 px). One "New campaign" at `/campaigns/new` (One role /
  Several roles); `/intake` and `/launch` redirect (next.config.mjs). Intake
  and Launch bodies moved to `src/components/campaigns/`. Candidates and
  Reports have tabs drawn by the shell (`SectionTabs`, `nav.ts` tab lists).
- 4f857323 (08) one /100 score (`ScoreBadge`, star picker removed), jargon
  removed (TAnIA, Path A/B, TOFU/MOFU, #Vivier, silver medalist), titles = nav
  labels, no fake numbering.
- d8e65492 (09) Carlito self-hosted in `public/fonts/carlito` (OFL), first in
  `--font-sans`; `.woff2` excluded from the auth proxy; one mode chip in the
  top bar; quieter active nav; eyebrows = nav group.
- (10) careers: in the synthetic demo (no Supabase, no `CAREERS_WORKSPACE_ID`)
  `/api/careers` serves the seed's 3 published roles and validates
  applications without storing them (`demo: true` in the response; chat says
  so). Offline copy written for candidates; header and chat share one column;
  no stars shown to candidates.

## Blockers

- None.

## Next steps

1. Replay "Run Aria" (camp_seed_design) and "Triage inbox" with Claude and check
   the "Drafted by Claude" badges, that drafts carry no [Name]/[Company]
   placeholders, and the Settings usage card.
2. AI issue 04 (prompt caching on the long system prompts), then triage 06-08.
3. Node: `export PATH="/c/Users/michael.bernard_amar/AppData/Local/Temp/aria-node-runtime/node-v22.23.4-win-x64:$PATH"`.
4. Screen checks: Playwright scripts in `%TEMP%/aria-e2e/ux0*.mjs`
   (`PROJ=<repo> node <script> <outdir>`, dev server on port 3123).

## Decisions made (don't relitigate)

- All AI runs on Claude via one Anthropic key, within 20-30 EUR/month; GDPR
  validated by the owner (2026-10-30).
- Model per task: Haiku for classify/extract, Sonnet for chat, outreach and
  sourcing, Opus only by explicit choice.
- Agents run in-process, client-side on top of store actions (ADR 0001).
- Sourcing spends only an admin vault key; the env/.secret key serves chat and
  local dev. Deterministic fallbacks everywhere; human approval before any send.
- UX: English UI ("Talent pool"), one /100 score, no personal credit (Mantu
  Group mention), Carlito self-hosted, nav per audit §4 with one "New campaign".
- Careers stays outside the workspace store provider (test-enforced); demo
  roles come from the API, not the browser store.

## Watch out

- Public demo (vercel-demo) needs ANTHROPIC_API_KEY (+ workspace id) after the merge.
- `next dev` can get stuck in a Fast Refresh full-reload loop on every route
  (seen 2026-11-02, not caused by code: same with the committed version).
  Restarting the dev server fixes it.
- Several files use CRLF line endings: multi-line `perl`/`sed` edits silently
  miss on them; use the Edit tool.
- `git add` with a path that no longer exists aborts the add; a following
  `git commit` then commits only what was already staged. Check `git show --stat`.
- `.next/types` and `.next/dev/types` keep stale routes after a page moves:
  run `npx next typegen` and restart the dev server before `npm run typecheck`.
- Missions run in the browser: closing the tab stops queued agents.
- Under tsx a module can load twice; use `isAgentTimeout`, not `instanceof`.
