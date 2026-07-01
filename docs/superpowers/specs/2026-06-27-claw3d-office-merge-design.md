# Claw3D Office Merge — Design Spec

**Date:** 2026-06-27 (§11 obscura addendum added 2026-07-01)
**Author:** Claude (with Tony)
**Status:** Approved — proceeding to implementation plan
**Source repo:** `https://github.com/iamlukethedev/Claw3D.git` (MIT, © 2026 Luke The Dev); §11 sidecar from `https://github.com/h4ckf0r0day/obscura` (Apache-2.0)
**Target repo:** `MSourcing` ("hermes-sourcing")

---

## 1. Goal

Replace MSourcing's current `/floor` 3D office — which renders agents as **static billboarded PNG sprites with no per-character animation** — with Claw3D's full 3D-office product: animated procedural characters (walk gait, breathe, sit, dance, six workout styles, ping-pong), A\* pathfinding, collision/separation, interaction zones, follow-cam, isometric camera, an office **builder**, and a live agent **gateway**. The office is driven by MSourcing's **real seats/agents** through the **Hermes runtime both apps already speak**.

"The full thing": import Claw3D wholesale — frontend, gateway, runtime adapters, server, builder — not just the animation engine.

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Integration depth | **Wholesale** import of Claw3D into the MSourcing repo |
| D2 | Deployment model | **Custom Node server + Docker** (adopt Claw3D `server/index.js`; leave Vercel serverless) |
| D3 | Framework target | **Next 16 + React 19 + Tailwind 4** (match Claw3D's tested config) |
| D4 | `/floor` fate | **Replace in place** — `/floor` renders Claw3D's office; no separate `/office`; delete old `floor3d/*` |
| D5 | Runtime data source | **Hermes** — shared between both apps; office shows MSourcing's real seats |

### Derived sub-decisions (my defaults — flag in review if wrong)
- Office **viewer** at `/floor`; office **builder** at `/floor/builder`; per-agent settings at `/agents/[agentId]/settings` (kept from Claw3D, gated behind MSourcing auth).
- Claw3D's `/api/office|gateway|runtime|studio|task-store|files|path-suggestions` import under their own paths; the colliding **`/api/health`** keeps MSourcing's implementation (Claw3D's is dropped).
- Old `src/components/floor3d/**` (active sprite engine + unused `retro/`, `RobotCharacter`, `RiggedCharacter`) and `public/office3d/**` sprite/GLB assets are **retired**; Claw3D's `public/office-assets/**` replace them. `tests/floor.mts` is rewritten against the new data adapter.

## 3. Architecture

### 3.1 Repo shape (single Next app)
```
MSourcing/
├── server/                     # NEW — from Claw3D (Node server + WS gateway proxy)
│   ├── index.js                #   app entry: Next handler + /api/gateway/ws upgrade
│   ├── gateway-proxy.js        #   browser ⇄ upstream gateway bridge (rate-limited)
│   ├── demo-gateway-adapter.js #   in-process demo gateway (no backend)
│   ├── hermes-gateway-adapter.js #  Hermes runtime adapter  ← wired to MSourcing Hermes
│   ├── access-gate.js · network-policy.js · studio-settings.js
├── src/
│   ├── app/
│   │   ├── (existing MSourcing routes unchanged: /, /fleet, /chat, /settings, …)
│   │   ├── floor/page.tsx       # REWRITTEN → renders Claw3D OfficeScreen
│   │   ├── floor/builder/page.tsx # from Claw3D /office/builder
│   │   ├── agents/…             # from Claw3D (auth-gated)
│   │   └── api/
│   │       ├── hermes/**        # MSourcing (kept)
│   │       ├── health/**        # MSourcing (kept; Claw3D's dropped)
│   │       └── office|gateway|runtime|studio|task-store|files|path-suggestions/**  # from Claw3D
│   ├── features/
│   │   ├── retro-office/**      # from Claw3D — the 3D engine (RetroOffice3D, agents, systems)
│   │   ├── office/**            # from Claw3D — Phaser builder/viewer + builder store
│   │   └── agents/**            # from Claw3D — AgentStore
│   ├── lib/
│   │   ├── (existing MSourcing: store.ts, ai/hermes*, supabase/**, floor.ts …)
│   │   ├── gateway/**           # from Claw3D — GatewayClient + openclaw client
│   │   ├── runtime/**           # from Claw3D — provider factory + openclaw/hermes/demo/custom
│   │   └── office/**            # from Claw3D — standup, etc.
│   └── components/
│       ├── (existing MSourcing components; floor3d/** DELETED)
│       └── ui/**                # from Claw3D — cva/clsx shadcn-style primitives
└── Dockerfile · next.config.* · tailwind v4 config · package.json (merged)
```

### 3.2 Server / deployment
- `node server/index.js` serves Next 16 **and** handles the `/api/gateway/ws` WebSocket upgrade. This replaces `next start` and the Vercel serverless model.
- Container: multi-stage Dockerfile (Node 22-slim) adapted from Claw3D's. Build sets `NEXT_PUBLIC_GATEWAY_URL`; runtime reads `CLAW3D_GATEWAY_*`.
- Target host: a long-running container (Fly.io / Render / VM / ECS). `vercel.json` is removed or repurposed; CI builds + pushes an image.
- `npm run dev` → `node server/index.js --dev`. `npm run demo-gateway` available for backend-free office testing.

### 3.3 Runtime data flow (office ⇄ Hermes ⇄ real seats)
1. Office page loads `OfficeScreen` (Claw3D) wrapped in `AgentStoreProvider`.
2. `GatewayClient` connects to `/api/gateway/ws` → `gateway-proxy.js` → **`hermes-gateway-adapter.js`** → MSourcing's existing `HERMES_API_URL`/`HERMES_API_KEY`.
3. An **adapter shim** maps MSourcing `AgentSeat[]` (`src/lib/floor3d.ts` `seatsToOfficeAgents`) → Claw3D `OfficeAgent[]` (`{id,name,subtitle,status,color,item,…}`), so the 3D scene shows live seats with correct working/idle/error state.
4. With no Hermes reachable, the office falls back to the **demo gateway** (mock agents) rather than breaking.

> Single source of truth for the Hermes bearer token stays MSourcing's server-side resolver (env + api_keys vault). The Hermes adapter is configured from the same env — no second token path. `HERMES_PROXY_ALLOW_LIST` extended only if the gateway needs new upstream paths.

### 3.4 Styling — Tailwind v3 → v4 migration
- Adopt Claw3D's v4 setup (`@tailwindcss/postcss`, `@import "tailwindcss"`, CSS-first `@theme`, `tw-animate-css`).
- Port MSourcing's design tokens (`--paper --canvas --ink --electric --aqua --violet --tangerine --mantu-yellow`, radii, shadows, keyframes `fade-in/scale-in/slide-in-right/shimmer/spin-slow`) into v4 `@theme` so the existing recruiting UI is visually unchanged.
- Reconcile the two `globals.css` (MSourcing design system + Claw3D zinc base + theme script). MSourcing tokens win for shared names.
- `tailwind-merge` 2→3; audit any `cn()`/merge call sites.

### 3.5 CSP / security headers (merged)
Union of both, least-privilege:
- `connect-src`: keep MSourcing's Supabase + add `ws: wss:` (same-origin gateway) and the configured gateway origin.
- add `worker-src 'self' blob:` (Phaser/troika workers), keep `script-src` with `blob:`.
- `frame-ancestors`: keep MSourcing's `'none'` (stricter than Claw3D's `'self'`).
- Keep MSourcing's HSTS, nosniff, referrer policy, permissions policy (allow `microphone=(self)` only if voice features are kept — see §7).

### 3.6 Auth
- MSourcing `middleware.ts` (Supabase SSR) continues to gate the app. `/floor`, `/floor/builder`, `/agents/**` sit behind auth like the rest. Claw3D's `STUDIO_ACCESS_TOKEN` gate is not used (MSourcing auth supersedes it).

## 4. Dependency target (npm-verified 2026-06-27)

Merged, deduplicated. Hard ceilings: `react <19.3` (r3f9 peer), `three <0.185` (postprocessing peer).

```jsonc
"dependencies": {
  "@noble/ed25519": "3.1.0",
  "@react-three/drei": "10.7.7",
  "@react-three/fiber": "9.6.1",
  "@react-three/postprocessing": "3.0.4",
  "@supabase/ssr": "0.12.0",
  "@supabase/supabase-js": "2.108.2",
  "canvas-confetti": "1.9.4",
  "class-variance-authority": "0.7.1",
  "clsx": "2.1.1",
  "framer-motion": "12.42.0",
  "lucide-react": "0.563.0",
  "next": "16.1.7",
  "phaser": "3.90.0",
  "postprocessing": "6.39.1",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "react-markdown": "10.1.0",
  "react-mentions-ts": "5.4.7",
  "recharts": "2.15.4",
  "remark-gfm": "4.0.1",
  "tailwind-merge": "3.6.0",
  "three": "0.184.1",
  "troika-three-text": "0.52.4",
  "ws": "8.21.0",
  "zod": "3.25.76"
},
"devDependencies": {
  "@playwright/test": "1.61.1",
  "@tailwindcss/postcss": "4.3.1",
  "@testing-library/jest-dom": "6.9.1",
  "@testing-library/react": "16.3.2",
  "@types/canvas-confetti": "1.9.0",
  "@types/node": "22.20.0",
  "@types/react": "19.2.17",
  "@types/react-dom": "19.2.3",
  "@types/three": "0.184.1",
  "@types/ws": "8.18.1",
  "eslint": "9.39.4",
  "eslint-config-next": "16.1.6",
  "tailwindcss": "4.3.1",
  "tsx": "4.22.4",
  "tw-animate-css": "1.4.0",
  "typescript": "5.9.3",
  "vitest": "4.1.9"
},
"overrides": { "three": "0.184.1", "react": "19.2.3", "react-dom": "19.2.3" }
```
- `eslint-config-next` pinned **16.1.6** to match Next 16 (the matrix's 15.5.19 was for the Next-15 path we did not choose).
- Node **20/22** required.

## 5. Phased implementation (high-level; detailed plan via writing-plans)

Each phase ends at a **green gate** (typecheck + targeted test/manual proof) before the next starts.

- **P0 — Branch + safety net.** Feature branch. Capture baseline: current `/floor` screenshots, `npm run test` (22 suites) + `typecheck` + `build` all green on Next 14. This is the regression oracle.
- **P1 — Framework upgrade only (no Claw3D yet).** Bump MSourcing to React 19 / Next 16, framer-motion 12, recharts 2.15, postprocessing 3, r3f9/three0.184/drei10, supabase/ssr 0.12, lucide 0.563. Migrate Tailwind v3→v4 + tokens. **Gate:** full app builds, all 22 tests pass, every existing route renders, old sprite `/floor` still works on the new stack. (Proves the upgrade is sound *before* adding new code.)
- **P2 — Import Claw3D as inert code.** Copy `server/`, `src/features/{retro-office,office,agents}`, `src/lib/{gateway,runtime,office}`, `src/components/ui`, `public/office-assets`, Claw3D API routes (namespaced, `/api/health` dropped). Merge configs (next.config, tsconfig paths, eslint, CSP). **Gate:** app still builds; new code compiles; existing routes untouched.
- **P3 — Mount the office at /floor.** Rewrite `floor/page.tsx` → Claw3D `OfficeScreen`; add `floor/builder`. Wire `server/index.js` as dev/prod entry. **Gate:** `/floor` renders the animated office against the **demo gateway**; characters walk/animate; builder loads.
- **P4 — Wire Hermes + real seats.** Hook `hermes-gateway-adapter` to MSourcing env; add `seats → OfficeAgent` shim; unify token resolution + allow-list. **Gate:** office shows real seats with correct live status; falls back to demo when Hermes is down.
- **P5 — Retire old floor + finalize.** Delete `floor3d/**`, `public/office3d/**`; rewrite `tests/floor.mts`; port Claw3D's vitest/playwright suites; finalize Dockerfile, env example, CI (container build). **Gate:** full test suite green; Docker image runs `/floor` end-to-end; CSP clean in console.
- **P6 — Obscura sidecar + Aria browser-session tool.** See §11. Add obscura as a second container/process alongside the Node server; add `server/obscura-adapter.js`; add `src/lib/ai/browser-tools.ts` (`browser_open`/`browser_act`/`browser_extract`/`browser_screenshot`/`browser_close`) to Aria's tool-loop. **Gate:** full test suite green; new browser-session tools pass their own test suite (SSRF guard, robots.txt, action-vocabulary allowlist, session TTL); manual proof against a real JS-rendered page (e.g. a SPA portfolio site).

## 6. Verification strategy
- **Regression oracle:** MSourcing's 22 `.mts` suites + typecheck + build must stay green through every phase (esp. P1).
- **New-code tests:** port Claw3D's vitest unit tests (navigation A\*, standup store, agent hydration) + Playwright office e2e.
- **Manual/visual:** Playwright MCP screenshots of `/floor` (demo + Hermes), compared against Claw3D's reference; confirm animation, pathfinding, builder, follow-cam.
- **Runtime:** verify `/api/gateway/ws` upgrade works behind the Node server; verify Hermes adapter round-trip; verify demo fallback.
- **Security:** re-run `npm run test:security`; verify merged CSP allows gateway WS + Phaser workers and nothing more; confirm auth still gates `/floor`.

## 7. Out of scope (YAGNI unless asked)
- **Voice (ElevenLabs)** office features — keep behind a flag, off by default (avoids new API keys + `microphone` permission). Decide in review if wanted.
- **OpenClaw / custom HTTP runtimes** — code comes along but only the **Hermes + demo** adapters are wired/tested. Others remain available, unverified.
- **Spotify callback** route from Claw3D — dropped unless wanted.
- **Multi-workspace/tenant** gateway routing — current single-workspace-per-session model retained.
- Net-new 3D features beyond what Claw3D ships.

## 8. Risks & mitigations
| Risk | Mitigation |
|------|------------|
| Tailwind v4 migration breaks existing recruiting UI | P1 isolates it; visual diff every existing route before adding Claw3D |
| React 19 hydration issues in the big HermesProvider store | P1 gate = all 22 tests + manual route sweep on new stack before new code |
| Vercel→container deploy regressions | Dockerfile validated in P5; keep deploy change additive until image proven |
| Two CSPs / WS blocked | Merged CSP tested with real gateway traffic in P3/P4 |
| Hermes token path duplicated | Single server-side resolver reused; no second token source |
| Phaser SSR crash | Loaded client-only via `next/dynamic { ssr:false }` |
| three 0.185 / react 19.3 pulled transitively | `overrides` lock |
| Obscura sidecar scope-creeps into a scraping-evasion tool (e.g. a later "just add a `type` action") | §11.5 action-vocabulary allowlist test fails CI if a text-input action is added without deliberately revisiting §11.2 |

## 9. Acceptance criteria
1. `/floor` renders Claw3D's animated 3D office (procedural characters moving, pathfinding, follow-cam, builder reachable).
2. Office reflects MSourcing's **real seats** via Hermes, with demo fallback.
3. Every pre-existing MSourcing route + all 22 test suites + typecheck + build pass on React 19 / Next 16 / Tailwind 4.
4. App runs from a Docker image via `node server/index.js`, WS gateway functional.
5. Old sprite `floor3d/*` fully removed; no dead assets; merged CSP clean.
6. Office is **on-brand**: 5 glossy colored robots + 1 suited human CEO (animated, not sprites), Mantu 'M' + wordmark on a feature wall, office themed to the real Mantu space (colorful baffles, living wall, wood floor, dome pendants, daylight windows).
7. `browser_open/act/extract/screenshot/close` (§11) work end-to-end against a real JS-rendered page via Aria's tool-loop.
8. Obscura binary in the shipped image has no `stealth` feature compiled in (verified: build log shows the exact `cargo build` invocation used, no Docker Hub image pulled).
9. Browser-session action vocabulary contains no text-input capability; SSRF + robots.txt enforced on every navigation, not just session open.

---

## 10. Mantu Branding, Characters & Office Identity

This section consolidates the character restyle, office theming, and branding work. It is **design-only**; all changes are procedural (materials, primitives, drei `<Text>`, `CanvasTexture`) — **no GLB character models and zero new GLB office assets** are required. Unless noted, all `file:line` anchors are under `Claw3D/src/features/retro-office/` (i.e. once imported, `MSourcing/src/features/retro-office/`).

The single architectural invariant that makes all of this safe: the `useFrame` animation rig (`objects/agents.tsx:100-566`) only drives **transforms on a fixed set of `THREE.Group` refs** (`groupRef`, `leftArmRef/rightArmRef/leftLegRef/rightLegRef`, eye/face/tool refs), never the child meshes. Swap the skin inside those groups (same `ref=`, same local origin) and walk / breathe / sit / dance / 6 workout styles / ping-pong / janitor all keep working untouched. The scene already mounts `<Environment preset="city" />` (`RetroOffice3D.tsx:5275`), so PBR materials pick up reflections with no lighting changes.

---

### 10.1 Brand palette (unified)

Reconciles MSourcing's compiled tokens (`--electric` decodes to **#6500AD ≈ the stated #6600AE**, `--mantu-yellow` to **#F8F15D**) with hexes sampled from the logo (purple/magenta field + lavender M strokes + warm amber dash) and the vivid office-accent set sampled from the Mantu photos. The **purple ramp is the canonical brand identity**; the office-accent and robot-shell families are brighter playful sub-palettes that coexist with it (see reconciliation note in 10.7).

| Family | Token | Hex | Maps to / source | Usage in 3D scene |
|---|---|---|---|---|
| Brand core | `mantu-ink` | `#1A0033` | `--ink` | Deepest backdrop, logo-card gradient bottom, QA-lab floor base |
| Brand core | `mantu-deep` | `#4C0074` | logo corner (new) | Feature-wall gradient dark stop, pod glass deep tint |
| Brand core | `mantu-purple` | `#59008B` | logo mid field | Primary brand fill |
| Brand core | `mantu-electric` | `#6500AD` | **`--electric` (primary)** | **Primary brand color** — accent stripes, glow, default `agent.color` |
| Brand core | `mantu-magenta` | `#8C1FC4` | ≈ `--tangerine`/`--violet` | Wordmark fill, logo warm stop, pod accent |
| Brand core | `mantu-violet` | `#AD3ADF` | `--violet` | Hover/secondary accent, light emissive |
| Brand core | `mantu-lavender` | `#C9A8E0` | logo M left stroke (new) | Translucent M stroke |
| Brand core | `mantu-lavender-lt` | `#F4ECFA` | ≈ `--electric-soft` | Bright M stroke, text-on-dark, nameplate text |
| Brand core | `mantu-white` | `#FCF5FD` | logo M highlight (new) | M highlight, wordmark on dark |
| Brand core | `mantu-amber` | `#F0B31C` | logo dash core (new) | Corner accent dashes, nameplate accent option |
| Brand core | `mantu-yellow` | `#F8F15D` | **`--mantu-yellow`** | Selection highlights, signage glow |
| Brand core | `mantu-orange` | `#E8862A` | logo dash shoulder (new) | Secondary warm accent, dash gradient |
| Brand core | `mantu-paper` | `#FAF8FC` | `--paper` | Light brand band / white-brick stand-in |
| Office accent | signage magenta | `#d81b9a` | photo sample | Vending front panel, baffles, pod graphics, "Mantu"/"COFFICE" text |
| Office accent | interior purple | `#7c3aed` | photo sample (existing QA floor) | Baffles, glass-pod accents (snap toward `mantu-violet`) |
| Office accent | bright yellow | `#f5c518` | photo sample | Baffles, bar-stool legs, signage |
| Office accent | warm orange | `#f07d0a` | photo sample | Baffles |
| Office accent | accent red | `#e0322a` | photo sample | Baffles, bench cushions |
| Office accent | burgundy | `#6a1b2a` | photo sample | Bar-stool seats |
| Office accent | OSB tan | `#d9b878` | photo sample | Plywood bench platforms |
| Robot shell | Blue / Orange / Green / Purple / Yellow | see 10.2 | photo sample | Per-agent robot body shells |
| Robot eye | eye cyan | `#2EF2FF` | photo sample | Glowing emissive robot eyes (off brand axis — intentional, matches reference) |

Logo-background gradient recipe (left→right): `#4C0074 → #59008B → #8C1FC4`; corner dashes warm sweep `#F8F15D → #F0B31C → #E8862A`.

---

### 10.2 Agent characters — Claw3D cast restyle

Five glossy robots + one suited human CEO, all driven by the **existing rig** (geometry/materials change only). Add a discriminator `variant?: "robot" | "human"` to `AgentModelProps` (`objects/types.ts:35`) and `OfficeAgent` (`core/types.ts:11`, or derive from `id === MAIN_AGENT_ID`). At the top of the `agents.tsx` return: `const isHuman = variant === "human"`; both branches declare the **same** limb/eye/face refs, so animation is identical.

| Agent | Shell hex | Assignment | Key mesh / material changes in `agents.tsx` |
|---|---|---|---|
| Blue | `#2B7DE9` | seatIndex 0 | Shared robot restyle (below) |
| Orange | `#F07C20` | seatIndex 1 | Shared robot restyle |
| Green | `#52A832` | seatIndex 2 | Shared robot restyle |
| Purple | `#8B45C9` | seatIndex 3 | Shared robot restyle |
| Yellow | `#F4C220` | seatIndex 4 (then `% 5`) | Shared robot restyle |
| Human / CEO | navy suit `#1C2740`, skin `#74503A` (between profile `deep`/`rich`), hair `ink #151515` | `MAIN_AGENT_ID` ("main") seat | Current human body path forced to CEO profile + new beard primitive |

**Shared robot restyle (body-part morph, inside existing groups):**

| Part | Current | Target | Change |
|---|---|---|---|
| Head/helmet | `boxGeometry [0.16,0.16,0.14]` 6-mat, `:930-938` | Glossy dome | `RoundedBox [0.17,0.16,0.15] radius=0.045`; `meshPhysicalMaterial color={color} roughness=0.22 clearcoat=1 clearcoatRoughness=0.12`; drop the face-texture split |
| Face panel | none | Black glossy panel | **New** `RoundedBox [0.135,0.075,0.012] radius=0.03` @ `[0,0.475,0.069]`, `meshPhysicalMaterial color="#0B0E14"`, inserted before eyes `:1035` |
| Eyes | `boxGeometry [0.03,0.03,0.01]` ×2, `:1035-1042` | Glowing cyan ovals | `capsuleGeometry [0.011,0.018,4,12]`; **keep refs** (blink scales `scale.x/y`, drives `position.y` `:396-401`); glow per below |
| Brows / mouth / corners | boxes `:1027-1086` | None on robots | Omit; refs stay null, every `useFrame` consumer is `if(ref.current)`-guarded (`:408,:433,:452`) |
| Torso | `boxGeometry [0.18,0.2,0.1]`, `bodyMatRef` `:779-782` | Rounded shell | `capsuleGeometry [0.105,0.10,6,16]` or `RoundedBox`; glossy `color={color}`; drop hoodie/jacket overlay `:783-806` |
| Arms | box upper inside arm groups `:807-925` | Ball-jointed | Shoulder `sphere r0.035` + `capsule [0.028,0.12]` @ y-0.08; **keep group origin** (swing `:179,238`) |
| Hands | `box [0.05]` `:818-821,:921-924` | Rounded mitt | `sphere r0.03` glossy `color` |
| Legs | box inside leg groups `:701-762` | Ball-jointed | Hip `sphere r0.03` + `capsule [0.03,0.10]`; keep origin (swing `:289,309`) |
| Feet | `box [0.07,0.05,0.12]` `:727-761` | Rounded | `RoundedBox [0.075,0.05,0.12] radius=0.025`, glossy |

**Glowing cyan eyes (Claw3D has NO bloom today — confirmed no `@react-three/postprocessing`):**
- **Route A (recommended v1, zero deps):** eye `meshStandardMaterial color="#0a1418" emissive="#2EF2FF" emissiveIntensity={2.2}` **plus `toneMapped={false}`** (the Canvas defaults to ACESFilmic, which would dim pure cyan). Reads as lit-from-within against the black panel; no halo.
- **Route B (optional Pixar halo, mirrors MSourcing):** add `@react-three/postprocessing`, wrap scene contents in `<EffectComposer><Bloom luminanceThreshold={1.0} mipmapBlur intensity={0.6}/></EffectComposer>` after the agents map (`RetroOffice3D.tsx:~5757`). With threshold ≈1.0 only the eyes bloom. Ship Route A; treat Bloom as an opt-in polish flag. (Note: MSourcing already ships `@react-three/postprocessing` v3 in the merged deps, so Route B adds no new top-level dependency.)

**Material gotchas (load-bearing):**
- `meshLambertMaterial` has no specular term and **cannot** look glossy — the shell **must** become `meshStandardMaterial`/`meshPhysicalMaterial`.
- `bodyMatRef` (`:93`, read for away-opacity `:359`) is typed `MeshLambertMaterial` — **retype** to `MeshStandardMaterial` or the assignment type-errors.
- **Away-fade traversal (`:360-369`)** matches `child.material instanceof THREE.MeshLambertMaterial`. Once shells are Standard/Physical this match misses every shell and the away/opacity fade **silently stops**. Broaden to `instanceof THREE.MeshStandardMaterial` (`MeshPhysicalMaterial extends MeshStandardMaterial`; `MeshBasicMaterial` eyes/panel correctly stay excluded).
- `faceTexture` useMemo (`:585-609`) paints a human face onto head `material-4` (`:936`) — gate to `isHuman` only.

**Human / CEO variant:** the mesh that exists *today is already the human* (boxy humanoid, hair styles `:939-988`, jacket/hoodie/tee `:783-806`, trousers/shoes/glasses/headset/cap) — so the CEO is the current code path with a forced profile, not new work. Force: `topStyle:"jacket"` recolored navy `#1C2740` (the jacket forces `sleeveColor=#dbe4ff` `:581` and white placket `:803` — recolor placket to black `#121212` so it reads as a black shirt under navy), `bottomColor:#1C2740`, `shoesColor:#1a1a1a`. **Beard** (only missing primitive): ~3 small meshes (`RoundedBox [0.13,0.05,0.06]` dark `#1C1411` at `~[0,0.43,0.05]` + side strips), rendered only when `isHuman`, or painted into the `faceTexture` canvas for zero meshes.

**Color wiring (touches P4):** today shell color comes from `resolvedAppearance.clothing.topColor` (`agents.tsx:569`); the `color` prop is only the nameplate stripe (`:1110`) and traces to `stringToColor(agentId)` (`OfficeScreen.tsx:212-219`) — an arbitrary hash, not the brand 5. Recommended: add `ROBOT_SHELL_COLORS` to `core/constants.ts:20`, seed each agent's `color = ROBOT_SHELL_COLORS[seatIndex % 5]` at hydration (`OfficeScreen.tsx:573-603`), and drive head/torso/arms/legs/hands/feet from the `color` prop (already passed at `RetroOffice3D.tsx:5720`). The nameplate stripe then brand-matches for free.

**Exact insertion points:** `core/constants.ts:20` (shell colors + material constants); `core/types.ts:11` + `objects/types.ts:35` (`variant`); `RetroOffice3D.tsx:5714-5753` (`variant={agent.id === MAIN_AGENT_ID ? "human" : "robot"}`; optional `<Bloom>` ~`:5757`); `OfficeScreen.tsx:573-603` (seed `color`, force CEO profile; `MAIN_AGENT_ID` at `:234`); `agents.tsx` — `:1` import `RoundedBox`, `:93` retype `bodyMatRef`, `:360-369` broaden fade `instanceof`, `:585-609` gate `faceTexture`, `:1035-1050` morph eyes + add black panel, branch the body build (`:701-988`).

**GLB alternative (flagged, not recommended):** `generate_3d` could produce glossy GLBs, but the rig is custom group-rotation, not skinned bones — a static GLB loses all animation and a rigged GLB needs bone retargeting into the 4-group scheme. Keep procedural; GLB only if the animation contract is ever relaxed.

---

### 10.3 Office environment — theming to Tony's real Mantu office

Keep the **orthographic isometric "dollhouse"** camera (`RetroOffice3D.tsx:5185-5201`, zoom 34, `OrbitControls maxPolarAngle=π/2.2`). There is **no ceiling mesh** and perimeter walls are only **1 world-unit tall** (`environment.tsx:541-635`). **Consequence:** every ceiling feature (acoustic baffles, dome pendants, cable trays, projector, spotlights) must render as **floating "mobiles" at y≈1.4-2.2** on hair-thin cables, NOT attached to architecture (flag poles already reach y=2.6). This is the single biggest thing to get right.

| Real-office feature | Render approach | Anchor |
|---|---|---|
| Honey wood-plank floor | Material: `meshLambertMaterial #c8a97e` → `meshStandardMaterial color="#c9a06a" roughness=0.6 metalness=0.04`; keep plank lines | `environment.tsx:245` (local), `:256` (remote); lines `:510-533` |
| Gray/brown carpet-tile zones | Reuse zone-plane + grid pattern; base `#6e6f6c`, tiles alternate `#5d5c59/#7a6a5c/#8a8784` | precedent gym `:360-389`, QA `:391-508` |
| **Colorful suspended acoustic baffles** (round blobs + squares) | **New** floating `cylinderGeometry` discs + flat `boxGeometry` slabs @ y≈1.6-1.9; palette `#ffffff,#f5c518,#f07d0a,#e0322a,#7c3aed,#d81b9a` | new group; copy garden-bed loop `:287-305` |
| **Black dome pendant lamps** (warm bulb, rows) | **New** thin cable `cylinder` from y≈2.0 → black hemisphere (`sphere thetaLength=π/2 #1a1a1a`) + emissive bulb `#ffd27f` | copy garden-light pole+sphere `:307-321` |
| White track spotlights | Minor: white rails + tiny emissive downlight discs (low priority) | same floating layer |
| **Green living wall** | **New** vertical box panel `#2f5d22` + instanced small green spheres/cones, flush to a perimeter wall | copy garden greens `:300-305` |
| Round wooden planters | `tableRound.glb` tinted wood base + `pottedPlant.glb` center | `furniture.tsx:22,:26`; tint `:78` |
| Black mesh office chairs | Retint `chair: "#4a5568"` → `"#2b2f36"` | `furniture.tsx:74`; GLB `:21` |
| Monitors / desk clusters | `computerScreen.glb`; `desk.glb` retint to `#b9966a` | `furniture.tsx:36,:19,:72` |
| White brick accent wall | Retint one wall `#f0ece2`, drop emissive, fake brick via mortar-line stripes | walls IIFE `:536-635`; lines `:510-533` |
| Purple "Mantu" wordmark | drei `<Text>` (see 10.4) | new `<Text>` in `WallPictures` `:681-1049` |
| Glass meeting pods w/ graphics | Reuse PhoneBooth/SmsBooth glass builders; lighten glass, scale up, add colored shape planes | `primitives.tsx:193-372,:374-521`; glass `:275-300` |
| **Burgundy bar stools / yellow legs** | **New** procedural (`cylinder` seat `#6a1b2a` + 4 `#f5c518` legs + footrest), OR map **orphan** `chairModernCushion.glb` tinted burgundy | `furniture.tsx:18-39` |
| Tall white bar table | `table.glb` tinted white `#f4f2ee`, raised | `furniture.tsx:29`, tint `:84` |
| **OSB plywood benches + cushions** | **New** OSB-tan `boxGeometry` `#d9b878` + olive/red cushion boxes | copy `:287-305` |
| Vending machines (magenta-lit) | Recolor front panel `#c02020` → `#d81b9a` + emissive back-glow strip; two side-by-side | `kitchen.tsx:43` |
| **Floor-to-ceiling daylight windows + trees** | **New** translucent `meshPhysicalMaterial` wall panel `#dbeeff` + `directionalLight`/`rectAreaLight` behind; `pottedPlant.glb` clusters outside as trees | window in walls IIFE `:610-632`; light at `:5251-5265` |
| Cable trays / projector | Minor floating dark rails + small white projector box @ y≈2.0 | same ceiling layer |
| "COFFICE" sign | drei `<Text>` magenta on far wall | `WallPictures` `:681-1049` |

**GLB coverage (asset budget: 0 new GLBs).** 17 GLBs on disk. **Covered by reuse+retint:** desks, black chairs, monitors, plants, round planters, bar/lounge tables, lounge seating, coffee/fridge/cabinet. **Covered by existing procedural models (retheme only):** vending (`kitchen.tsx:5-69`), glass pods (`primitives.tsx:193-521`), carpet zones (`environment.tsx:360-508`), floor/walls. **Must be added procedurally (~8 small groups):** baffles, dome pendants, living wall, bar stools, OSB benches, daylight windows, cable trays/projector/spotlights, signage. **Notable finding:** `chairModernCushion.glb` is an **orphan** (on disk, referenced nowhere) — free win for bar stools/lounge chairs.

**Lighting / material (authoritative edit point):** the live rig is the **static lights at `RetroOffice3D.tsx:5251-5265`** + `Environment preset="city"` `:5275`. The `DayNightCycle` component (`cameraLighting.tsx:296-369`) is **dead code — never imported/mounted; editing its keyframes does nothing.** Proposed: ambient `0.72→0.95 color #ece6d8`; key (sun) `1.1→1.35 color #fff4e0`; fill `0.4→0.35 color #dfe9ff` (current saturated blue reads cold); **new** window `directionalLight 0.8 #fff8ec`; keep `city` (or try `lobby`); add `toneMappingExposure: 1.12` at `:5196`.

---

### 10.4 Branding placement — 'M' mark + 'Mantu' wordmark

**Capability baseline:** drei `<Text>` (troika) is available and used (`machines.tsx:258`, `agents.tsx:1116`, `visualSystems.tsx:257`); `THREE.CanvasTexture` is proven (`agents.tsx:585-609`); `useTexture`/`TextureLoader` is **not used anywhere yet** (no image-texture pipeline exists). Walls are only 1.0u tall, so a logo either sits in the y≈0.45-0.95 band or is treated as a **mounted sign floating above the wall line** (legitimate — flag poles rise to y=2.6).

**The 'M' mark — recommend procedural `CanvasTexture` (Option B) for v1, `useTexture` PNG (Option A) as the clean-asset upgrade.** Everything in the office renders procedurally and there is no loader path, so a `CanvasTexture` M (gradient `#4C0074→#59008B→#8C1FC4` + two rounded-cap chevron strokes + amber corner dashes) keeps architectural consistency, needs zero assets, and recolors from the palette tokens. Swap to `useTexture("/brand/mantu-m.png")` once a clean transparent cutout exists. (Extruded `ExtrudeGeometry` relief = Option C, reserve for a physical lobby sign only.)
- **Component:** define `MantuLogoWall` beside `FramedPicture` at `scene/environment.tsx:23-61` (back gradient card + front plane with the M texture).
- **Render:** at the `{null}` placeholder slot `scene/environment.tsx:1046` (just before `</group>`), using existing helpers `localCenterX/northZ/southZ/westX/eastX/pictureY` (`:686-695`). North feature wall, centered. `position=[localCenterX, 0.86, northZ]`, `size=[1.25,1.25]` to read as a large lobby logo rising above the wall.

**The 'Mantu' wordmark — recommend troika `<Text>` in `mantu-magenta #8C1FC4` on a light brand band.** The PhoneBooth "PHONE" sign (`objects/machines.tsx:258-266`) is the exact template. Create a light plane in `mantu-paper #FAF8FC` (standing in for the white-brick wall) + `<Text fontSize≈0.42 color="#8C1FC4" anchorX="center" anchorY="middle" outlineWidth=0.004 outlineColor="#1A0033">mantu</Text>`. Place on the **south wall** (faces camera on entry) via `southZ` (`:693`) with `rotation=[0,Math.PI,0]` (matches south-wall art rotation `:851`), or beneath the M on the north wall. **Add `import { Text } from "@react-three/drei"` to `environment.tsx`** — it is not imported there yet. Brand-faithful weight needs a `.woff` of Mantu's face; default bold sans is acceptable for v1.

**Other on-brand touches:**
| Touch | Where | Recommendation |
|---|---|---|
| Loading-screen logo | `OfficeScreen.tsx:~4680` (DOM overlay) | `<img src="/brand/mantu-m.png">` over a `#1A0033→#59008B` gradient — cheapest high-impact moment |
| Tab title / favicon | `app/layout.tsx:6-7` (`title:"Claw3D"`) | Retitle "Mantu Office" + Mantu-M favicon |
| Nameplate accent (touches P4) | `systems/visualSystems.tsx:253-256,:260` | Default empty `agent.color` → `mantu-electric #6500AD`; text → `mantu-lavender-lt #F4ECFA` |
| Pod / phone-booth glass | `machines.tsx:274-300` (`#bae6fd`), sign `:261` | Glass → `mantu-violet #AD3ADF` low opacity; "PHONE" text → `mantu-yellow #F8F15D`; optional frosted Mantu-M decal |
| QA-lab floor grid | `environment.tsx:456,465,487` | Already `#7c3aed`; snap to `mantu-electric #6500AD`, drop off-brand cyan `#38bdf8` → `mantu-violet` |
| Selection/hover highlight | `primitives.tsx:82-87` | Optional: hover `#4a90d9`→`mantu-violet #AD3ADF`; select `#fbbf24` ≈ `mantu-amber` already |

---

### 10.5 Asset inventory

| Asset path | Status | Use |
|---|---|---|
| `MSourcing/public/brand/mantu-logo-source.jpg` | **Present** (saved 2026-06-27, 11.7K) | Source for derived M cutout, loading screen, favicon |
| `MSourcing/public/brand/mantu-agents-reference.png` | **Present** (saved 2026-06-27, 1.4M) | The 5 robots + 1 human styling target |
| `MSourcing/docs/superpowers/specs/assets/{mantu-logo.jpg, mantu-office-coworking.jpg, mantu-office-lounge.jpg, mantu-agents-reference.png}` | **Present** (saved 2026-06-27) | Spec-side design reference gallery |
| `MSourcing/public/brand/mantu-m.png` (+ ideally `.svg`) | **To be derived** — clean transparent cutout of just the two rounded-cap chevron M strokes (no purple bg, no dashes) | Option A texture, loading logo, favicon |
| Mantu brand font `.woff`/`.woff2` | Not present | troika `font` prop for brand-faithful wordmark (v1 uses default sans) |
| Office GLBs | 17 on disk (from Claw3D); **0 new required** (orphan `chairModernCushion.glb` reused) | Furniture |
| Character GLBs | **None needed** — restyle is fully procedural | — |

> Correction to the branding analysis: it reported `mantu-logo-source.jpg` as missing because it inspected **Claw3D's** `public/`, not MSourcing's. The brand assets **are** committed in `MSourcing/public/brand/`. The procedural-first path (CanvasTexture M + drei `<Text>` wordmark) still needs **no** committed assets for v1; the clean transparent 'M' cutout is the only derived asset, for the Option-A polish swap.

---

### 10.6 Phase mapping

- **P3 (mount office at /floor — the bulk of visual work):** brand palette constants (10.1); robot mesh/material restyle + glowing cyan eyes Route A + human/CEO geometry & beard (10.2 mesh side); entire office theming — floor/walls/carpet zones, ceiling-prop "mobiles," living wall, pods, vending, bar stools, OSB benches, daylight windows, lighting rig edits, keep ortho iso camera (10.3); Mantu 'M' wall + wordmark + loading screen + favicon + pod/QA-floor recolors (10.4); deriving the clean 'M' cutout (10.5).
- **P4 (wire Hermes + real seats — character data mapping):** seed each agent's `color` from `ROBOT_SHELL_COLORS[seatIndex % 5]` against real seats (`OfficeScreen.tsx:573-603`); decide which real agent is the human CEO (replacing the demo `MAIN_AGENT_ID="main"` heuristic) and feed `variant`; nameplate accent driven by real `agent.color` (`visualSystems.tsx:253-256`).
- **Optional polish (any phase):** Bloom Route B for the cyan-eye halo; Option A PNG texture swap for the M; brand `.woff` for the wordmark; cleanup/removal of dead `DayNightCycle`.

---

### 10.7 Open assumptions / decisions for review

- **Palette divergence:** brand-core purple and the photo-sampled office-accent set are two independently sampled systems with overlapping-but-unequal hexes. Decision: snap office accents to nearest brand token (cleaner identity) vs keep the brighter photographic set (more faithful to the room). Recommendation: snap to brand where it doesn't fight the photo read; keep baffles vivid.
- **Robot shells + cyan eyes are deliberately off the purple brand axis** to match the multicolor reference cast — intentional, confirm acceptable.
- **CEO selection (P4):** demo uses `MAIN_AGENT_ID === "main"`. Real seats need an explicit role/flag — which real Hermes agent is the human CEO is unspecified.
- **`stringToColor` replacement** assumes a stable, deterministic `seatIndex` ordering so colors don't reshuffle between loads; with >5 agents the `% 5` cycle repeats shell colors (acceptable).
- **CEO skin tone `#74503A`** + **beard primitive** (not in `AgentAvatarProfile` schema) are net-new design values.
- **`rectAreaLight`** for the daylight window needs `RectAreaLightUniformsLib` init; `directionalLight` is the safe fallback. `toneMappingExposure: 1.12` is global — verify it doesn't blow highlights on glossy shells.
- **Unspecified layout details (decide during P3 build):** positions/counts/spacing of baffles, pendant rows, OSB benches, bar stools; which wall hosts white-brick / living wall / daylight windows; whether to show both "Mantu" wordmark and "COFFICE" sign.
- **Brand font** unavailable; v1 ships default bold sans (not marketing-exact).

---

## 11. Obscura sidecar — Aria's browser-session tool (P6)

**Source:** `https://github.com/h4ckf0r0day/obscura` (Apache-2.0) — a Rust headless browser engine, CDP/Puppeteer/Playwright-compatible, ~30MB RSS / instant startup. Ships an optional `--features stealth` (anti-detect fingerprinting) that this design **does not use**.

### 11.1 Why

Aria's existing web-research tools (`src/lib/ai/web-tools.ts`) are deliberately a plain, non-evasive `GET` + HTML-strip: no JS execution, no cookies, no multi-step interaction. That's the right default for simple pages, but it can't read JS-rendered sites (candidate portfolio SPAs, GitHub Pages apps) or handle pagination/"load more"/infinite-scroll/cookie-consent walls that block the plain fetch from ever seeing the real content. Obscura closes that gap: real V8 execution, small footprint, fits as a sidecar in the P2 `server/` scaffold instead of standing up separate hosting.

### 11.2 Hard scope boundary (non-negotiable, structural — not a policy note)

This tool is **read-only multi-step public-page browsing**. It is explicitly **not** a login/session/scraping-evasion tool:

- **No stealth.** Obscura is built from source at a pinned tag with **default cargo features only** (`cargo build --release`, `--features stealth` never passed). Building from source (not pulling the `h4ckf0r0day/obscura` Docker Hub image) is deliberate — it makes the omission auditable in our own Dockerfile rather than trusting an unverified upstream image's build flags.
- **No credential entry, structurally.** The action vocabulary exposed to the model is `click | scroll | wait | back | forward` only. There is **no `type`/`fill`/`submit` action** — the vocabulary itself has no way to enter text into a field, so login forms cannot be completed regardless of what the model is asked to do. This isn't a prompt-level instruction the model could be talked out of; the capability doesn't exist in the adapter's API surface.
- **No persistent identity.** Each `browser_open` call gets a fresh, cookie-empty browser context. Cookies set during a session live only for that session's lifetime and are discarded on close — never written to disk, never reused by a later session, never shared across seats/agents.
- **Bounded session lifetime.** Idle timeout 60s, hard wall-clock cap 5 min, auto-close either way. No session can be kept alive indefinitely to accumulate an authenticated-looking browsing history.
- **SSRF + robots.txt on every hop, not just the first.** `assertPublicUrl` (existing guard from `src/lib/api/url.ts`) runs before `browser_open` **and** before every same-session navigation triggered by `back`/`forward`/a link-following `click`. Additionally — because this tool is materially more capable than the plain fetch tools — `browser_open` fetches and checks the target's `robots.txt` and declines to open a path it disallows for `*` or our UA token.
- **Honest UA, unchanged.** Same `AriaResearchBot/1.0 (+read-only; ...)` UA the existing tools send, passed to obscura via CDP `Network.setUserAgentOverride`. Obscura's anti-detect fingerprinting is off (no stealth feature compiled in), so this is genuinely identifiable automated traffic, not a browser impersonation.

### 11.3 Architecture

```
server/
├── index.js                    # existing (P2) — Next handler + /api/gateway/ws upgrade
├── obscura-adapter.js           # NEW — owns the obscura sidecar process + session table
└── ...
src/lib/ai/
├── web-tools.ts                 # existing — unchanged, still the cheap default
└── browser-tools.ts             # NEW — tool defs + dispatch for browser_open/act/extract/screenshot/close
```

- **Process:** obscura runs as a second process/container next to the Node server (own Dockerfile stage, built from source per §11.2), listening on a loopback-only CDP port (not exposed outside the container network). `server/obscura-adapter.js` is the only thing that talks to it — analogous to `hermes-gateway-adapter.js` owning the Hermes connection today.
- **Session table:** `obscura-adapter.js` holds `Map<sessionId, {tab, openedAt, lastActivityAt}>`; a interval sweeper enforces the idle/hard timeouts from §11.2 and closes/evicts expired tabs.
- **Tool dispatch:** `src/lib/ai/browser-tools.ts` exposes 5 tools in the same `{ok, content, error}` shape `runWebTool` already uses, so the tool-loop dispatches to it interchangeably:
  - `browser_open(url)` → SSRF + robots.txt check → new obscura tab, navigate, wait for load → `{sessionId, title, text}`
  - `browser_act(sessionId, action)` → `action` is one of `{type: "click", selector} | {type: "scroll", direction} | {type: "wait", ms|selector} | {type: "back"} | {type: "forward"}` → re-runs SSRF check on the resulting URL if it changed → `{url, title, text}`
  - `browser_extract(sessionId)` → current page text/links, same `stripHtml`-style shape as `fetch_page`
  - `browser_screenshot(sessionId)` → PNG (base64, size-capped)
  - `browser_close(sessionId)` → explicit early close (idle/hard timeout close it anyway)
- **Internal transport:** `obscura-adapter.js` exposes a small loopback HTTP API (`POST /session`, `/session/:id/act`, etc.) that `browser-tools.ts` calls via `fetch("http://127.0.0.1:<port>/...")` — same pattern as the existing internal Hermes proxy, not a new external attack surface.

### 11.4 Error handling

- Obscura process crash/unreachable → adapter returns `{ok:false, error:"Browser sidecar unavailable."}`; tool-loop treats it like any other failed tool call (existing behavior in `runWebTool`'s catch-all).
- Unknown/expired `sessionId` → `{ok:false, error:"Session not found or expired."}`.
- `robots.txt` disallow → `{ok:false, error:"Blocked by robots.txt."}`.
- SSRF guard reject → same message shape `web-tools.ts` already uses (`guard.reason`).

### 11.5 Testing

- Unit: action-vocabulary allowlist rejects anything outside `click/scroll/wait/back/forward` (proves no `type`/`fill` path exists even if someone tries to add one later without touching this test); SSRF guard invoked on open + every navigation; robots.txt parsing/deny; session TTL sweep.
- Integration: real obscura sidecar in CI (Docker service container), `browser_open` a local fixture SPA page, `browser_act` click a "load more", `browser_extract` confirms new content appeared, `browser_close`.
- Manual/visual: point at a real JS-rendered public page (e.g. a candidate's portfolio SPA) end-to-end through Aria's chat, confirm rendered text comes back where plain `fetch_page` would return an empty shell.

### 11.6 Additions to earlier sections

- **§4 dependencies:** obscura is **not** an npm package — it's a Rust binary built in its own Dockerfile stage (pinned upstream git tag, `cargo build --release`, default features). No entry in `package.json`.
- **§8 risks** and **§9 acceptance criteria** rows for obscura are folded directly into those sections above (risk row + items 7-9).
