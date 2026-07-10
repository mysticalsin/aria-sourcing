---
project: MSourcing / ARIA
shift: 18
agent: codex
updated: 2026-07-10 11:46
status: r2-dead-code-hygiene-tsc-clean
---

# Handoff - R2 Dead Code + Hygiene Purge

## Current state
- Release Rock R2 dead-code and hygiene purge is implemented in the working tree.
- The live 3D floor path remains `Floor3D.tsx -> retro/RetroOfficeScene.tsx -> RobotAgentModel/RobotCharacter/RiggedCharacter + RetroEnvironment/PacketFX/agentTick/core`.
- Shared floor contracts and packet pure helpers now live in `src/lib/floor3d.ts`.
- Components and lib modules import floor shared types/helpers from `@/lib/floor3d`; no live lib file imports from `src/components/floor3d`.
- `vercel.json` no longer defines static security headers. `next.config.mjs` owns CSP/security headers and carries production HSTS.
- Root PNG screenshots were moved to `docs/screenshots/archive/`; `.gitignore` now ignores only root-level `/*.png`.

## Done this shift
- Removed verified-unreachable 3D files:
  - `src/components/floor3d/Floor3DScene.tsx`
  - `src/components/floor3d/InstancedAgents.tsx`
  - `src/components/floor3d/OfficeRoom.tsx`
  - `src/components/floor3d/OfficeFurniture.tsx`
  - `src/components/floor3d/SpriteCharacter.tsx`
  - `src/components/floor3d/CityWorld.tsx`
  - `src/components/floor3d/retro/objects/AgentModel.tsx`
  - `src/components/floor3d/retro/core/avatarProfile.ts`
  - `src/components/floor3d/retro/objects/RobotAgent.tsx`
  - `src/components/floor3d/retro/scene/OfficeEnvironment.tsx`
- Removed dead barrels:
  - `src/components/app/index.ts`
  - `src/components/chat/index.ts`
- Removed obsolete floor helper/type files after moving their live exports to lib:
  - `src/components/floor3d/retro/scene/packet-shared.ts`
  - `src/components/floor3d/types.ts`
- Removed `@react-three/postprocessing` and `postprocessing` from `package.json` and `package-lock.json`.
- Updated import paths in the live scene, floor page, mission HUD, replay, and Aria Live demo director.
- Archived previous baton to `_relay/archive/2026-07-10-1146-codex.md`.
- Added project-local Codex learning in `_agent_state/codex/memory.json`.

## Blockers
- Sandbox blocks `.git/index.lock`, so `git rm` / `git mv` could not stage changes:
  - `fatal: Unable to create '.git/index.lock': Operation not permitted`
  - Files were removed/moved in the filesystem; Git status shows deletions and new archive files for the next committer.
- Sandbox blocks the `tsx` CLI IPC server:
  - `Error: listen EPERM: operation not permitted .../tsx-501/*.pipe`
  - The same floor test passed via `node --import tsx tests/floor.mts`.

## Verification
- `graphify query "Rock R2 MSourcing Floor3D dead code packet-shared postprocessing vercel CSP screenshots" --budget 1500` failed because `graphify-out/graph.json` is absent.
- `npm install --package-lock-only` passed; only existing Node engine warning for `@dust-tt/client@1.2.6` under Node `v22.22.3`.
- `npx tsc --noEmit` passed with exit 0.
- `node --import tsx tests/floor.mts` passed:
  - `RESULT floor: 11 passed, 0 failed`
- Exact `npx tsx tests/floor.mts` is sandbox-blocked by `listen EPERM` on the tsx temp pipe.
- `rg` found zero imports of the deleted 3D files.
- `rg` found zero imports/usages of `@react-three/postprocessing` or `postprocessing` in `package.json`, `package-lock.json`, `src`, and `tests`.
- `find . -maxdepth 1 -type f -name '*.png' -print` returned no root PNG files.
- `node` check confirmed `vercel.json` has no `headers` block and `next.config.mjs` contains `Strict-Transport-Security`.
- `git diff --check` passed with exit 0.

## Next steps
1. Visionary/full-runner runs the full external gate outside this sandbox, including exact `npx tsx tests/floor.mts` if its environment permits tsx IPC.
2. Commit this R2 working-tree change separately from pre-existing dirty content.

## Decisions made (don't relitigate)
- The Tarjan/reachability audit is accepted as authoritative for the 10 dead files.
- `three`, `@react-three/fiber`, `@react-three/drei`, and `troika-three-text` stay.
- `next.config.mjs` is the single source for security headers.
- Root-level PNG clutter belongs under `docs/screenshots/archive/`; docs/public images are not ignored.

## Watch out
- Pre-existing dirty/untracked files before this shift included:
  - `.claude/scheduled_tasks.lock`
  - `.rocket-fuel/`
  - `Aria/`
  - `_agent_state/`
  - `_relay/HANDOFF.md`
  - `_relay/archive/2026-07-10-1138-codex.md`
  - `docs/superpowers/plans/`
  - `graphify-out/`
  - `src/app/fleet/page.tsx`
  - `src/lib/fleet-seats.ts`
- Because `.git` writes are blocked, screenshot moves appear as root deletions plus untracked `docs/screenshots/archive/` additions rather than staged renames in this sandbox.
