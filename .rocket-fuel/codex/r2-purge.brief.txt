You are the Integrator building release Rock R2 in the MSourcing repo. workspace-write. Owner standard: enterprise-ready, senior-dev-clear, no slop. This is the dead-code + hygiene purge a structure audit specified with verified reachability analysis — execute it EXACTLY; do not re-litigate what is dead.

Objective: remove the verified-unreachable code, dead dependencies, dead barrels, the lib→components layering inversion, and repo-root screenshot clutter — so a senior dev cold-reading the tree sees one live implementation of everything.

Read first: (understand before editing)
- Audit facts (verified by Tarjan-SCC + reachability over all entrypoints): live 3D path is ONLY Floor3D.tsx → retro/RetroOfficeScene.tsx → RobotAgentModel/RobotCharacter/RiggedCharacter + RetroEnvironment/PacketFX/packet-shared/agentTick/core (+ troikaConfig.ts side-effect import). UNREACHABLE (10 files, ~3,257 lines): src/components/floor3d/Floor3DScene.tsx, InstancedAgents.tsx, OfficeRoom.tsx, OfficeFurniture.tsx, SpriteCharacter.tsx, CityWorld.tsx, retro/objects/AgentModel.tsx, retro/core/avatarProfile.ts (only importer is AgentModel), retro/objects/RobotAgent.tsx, retro/scene/OfficeEnvironment.tsx.
- package.json: @react-three/postprocessing imported ONLY by dead Floor3DScene.tsx; postprocessing exists only as its peer. Both removable. KEEP three, @react-three/fiber, @react-three/drei, troika-three-text.
- Dead barrels (0 importers): src/components/app/index.ts, src/components/chat/index.ts.
- Layering inversion: src/lib/demo/aria-live.ts:48 imports pickResponderIndex from @/components/floor3d/retro/scene/packet-shared; src/lib/replay.ts:2 + src/lib/floor3d.ts:3 import type OfficeAgent from @/components/floor3d/types. Fix: move packet-shared's pure exports (EVENT_COLOR, pickResponderIndex, etc.) and the OfficeAgent type into src/lib/floor3d.ts; components import from lib (4 import-path edits; no logic change; keep a thin re-export at the old packet-shared path ONLY if >2 component files import it, else update the importers).
- Root clutter: loose *.png screenshots at repo root (aria-app.png, city-3d-hero.png, dash-glass.png, office-v2.png, floor3d-first.png, kimi-live-chat-proof.png, settings-admin.png, ...). docs/screenshots/ exists.
- vercel.json duplicate CSP: next.config.mjs is authoritative (drops unsafe-eval in prod); vercel.json's static headers block drifted. Delete the headers block from vercel.json EXCEPT keep Strict-Transport-Security if next.config.mjs lacks it — check first; if missing, add HSTS to next.config.mjs prod headers instead.

Build:
1. git rm the 10 unreachable files. Remove @react-three/postprocessing + postprocessing from package.json and update the lockfile (npm install --package-lock-only or npm uninstall).
2. Delete the two dead barrels.
3. Fix the layering inversion as specified (lib owns the shared pure code + type; components import from lib).
4. git mv the root *.png screenshots into docs/screenshots/archive/ (create it). Add `/*.png` to .gitignore (root-level only — do NOT ignore docs/ or public/ images).
5. CSP: single source per the rule above.
6. Update tests/floor.mts or any test referencing deleted files if (and only if) it imports them — do not weaken assertions about the LIVE scene.

Constraints: (what must NOT change) the live retro scene must render exactly as before (no changes to live-path files beyond import-path edits); no behavior changes anywhere; do not weaken or delete tests except references to deleted-dead files; keep three/fiber/drei/troika deps.

Proof: `npx tsc --noEmit` clean; `npx tsx tests/floor.mts` passes; grep proves zero remaining imports of the 10 deleted files and zero imports of @react-three/postprocessing; `ls *.png` at root is empty. The Visionary runs the full gate outside the sandbox.

Stop when: deletions + dep removal + barrel removal + layering fix + screenshot move + CSP single-source are done and tsc is clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = done + tsc clean; REVISE = blocked/incomplete (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
