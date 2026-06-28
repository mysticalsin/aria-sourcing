# FRONTEND PERFORMANCE REPORT — MSourcing (Aria / Hermes Sourcing by Mantu)

**Phase 3 deliverable — Frontend Performance Engineer.** Audit date: 2026-06-27. New document.
Maps to **Release Gate 3 — Frontend (frontend-perf part)**; cross-references Gate 10 (Performance/reliability).

Scope: bundle size, lazy loading & code-splitting (3D floor especially), image optimization,
caching, Core Web Vitals risks, unnecessary network calls, memory leaks (useFrame loops, store
subscriptions), and render bottlenecks. **Audit-only**: no app source was modified. Evidence is
repo-verified (`file:line`) or from a real local production build run during this audit.

Working tree was **dirty** at audit time (73 modified / many untracked per `git status`); findings
reflect the current on-disk tree on branch `main`.

---

## Executive summary

The frontend is, in several respects, **competently optimized for a demo**: the heavy 3D floor is
correctly code-split behind `next/dynamic({ ssr: false })` and is **excluded from the floor route's
First Load JS**, the 3D animation loop is **ref-based** (no React state per frame), `framer-motion`
is scoped to the login page only, and the active 3D scene loads a lean set of small GLBs.

However, there are **real, evidenced performance defects** that block a PASS:

1. **`recharts` is eagerly bundled** into the four most important data routes — including the
   authenticated **landing route `/`** — inflating First Load JS to **~330–361 kB** vs **~217–246 kB**
   for non-chart pages (a **~110 kB delta** attributable to recharts not being split).
2. **One giant React context** (`HermesContext`, `store.ts` ~3030 lines) re-renders **every consuming
   component on every state mutation** — no selector subscription, no context split — and several
   selectors return fresh arrays each render.
3. **Whole-state persistence on every mutation**: demo mode runs a synchronous
   `JSON.stringify(state)` of the entire workspace to `localStorage` on **every** change.
4. **Login (entry) route**: a **523 kB PNG logo via a raw `<img>`** (unoptimized, no dimensions →
   CLS) plus an autoplay **CloudFront `.mp4` background** with no poster/preload control.
5. **Dead code + asset bloat**: an entire alternate 3D scene (`Floor3DScene.tsx` and its subtree) is
   **never imported**, dragging in the `postprocessing` deps used nowhere else and **~13.4 MB of
   character sprite PNGs** that are never loaded at runtime; `public/office3d` totals **22 MB**.
6. **Core Web Vitals are unmeasured** — no Lighthouse run, no field/RUM data, no perf budget in CI.

With current **synthetic demo data volumes** (4 seats, ~52 candidates) the app feels fast; items
2, 3 and the lack of list virtualization are **scalability risks** that bite at production data
volumes, not at demo scale. None of the findings rise to CRITICAL/HIGH on the security-weighted
rubric, but the combination of evidenced open MEDIUM defects plus **unmeasured Core Web Vitals**
means this part of the gate is **not releasable**.

### Gate 3 (frontend-perf part): **FAIL**
- Verified-good: 3D code-splitting (PASS), 3D render-loop memory profile (PASS).
- Open defects (MEDIUM): recharts bundle bloat on the landing route; single-context re-render storm;
  full-state synchronous persistence; login image/video weight; dead-code & 22 MB asset bloat; no
  list virtualization.
- Unverifiable (UNKNOWN, blocked): Core Web Vitals (LCP/INP/CLS) — needs a running/deployed
  instance + Lighthouse/RUM; production CDN cache behaviour — needs deployed infra.

---

## Evidence base

### Real production build (run during this audit)
`rm -rf .next && NEXT_TELEMETRY_DISABLED=1 npm run build` — **compiled successfully** (Next 14.2.35).
Route-level First Load JS (verbatim from build output):

| Route | Page size | First Load JS | Note |
|---|---|---|---|
| `/` (dashboard, landing) | 9.25 kB | **333 kB** | recharts |
| `/candidates` | 1.76 kB | **333 kB** | recharts via drawer/score |
| `/reports` | 3.19 kB | **330 kB** | recharts |
| `/campaigns/[id]` | 11.8 kB | **361 kB** | recharts (largest) |
| `/fleet` | 13.2 kB | 229 kB | no charts |
| `/settings` | 21.5 kB | 246 kB | no charts |
| `/outreach` | 4.99 kB | 232 kB | |
| `/calendar` | 3.97 kB | 222 kB | |
| `/chat` | 5.69 kB | 221 kB | |
| `/floor` | 8.59 kB | **233 kB** | **3D libs correctly NOT in first load** |
| `/login` | **41.4 kB** | 196 kB | framer-motion |
| Shared by all | — | **87.7 kB** | baseline |
| Middleware | — | 82.6 kB | Supabase SSR |

Build warnings observed (perf/correctness-adjacent, noted for other lanes):
`@supabase/supabase-js` uses `process.version` (a Node API) under the **Edge Runtime** (middleware);
webpack "Serializing big strings (250kiB) impacts deserialization performance"; Google-Fonts
stylesheet optimization skipped (no network in sandbox — would inline in prod).

> Note: `.next/` was not inspectable after the build (the repo lives on OneDrive CloudStorage and
> the directory was reaped from the FS view post-build), so per-chunk byte attribution below is
> inferred from the route table deltas rather than from the chunk files. The route-level First Load
> JS numbers above are authoritative (captured from build stdout).

### Asset sizes (`stat`, repo)
- `public/office3d` total: **22 MB**.
- Character sprite PNGs (6): blue 2315 KB, green 2286 KB, human 2058 KB, orange 2202 KB, purple
  2296 KB, yellow 2233 KB → **~13.4 MB** (`public/office3d/characters/*.png`).
- Largest GLBs (NOT loaded by the active scene): `wooden_table.glb` 3499 KB, `biz_man.glb` 1493 KB,
  `sofa_chair.glb` 1321 KB, `man.glb` 482 KB, `employee.glb` 236 KB.
- Active 3D set (preloaded by `retro/scene/RetroEnvironment.tsx`): ~13 small GLBs ≈ **~165 KB**
  (desk 15, chairDesk 38, bookcaseClosed 23, kitchen* ~36, lounge/plant/lamp/screen ~60).
- Login logo `public/aria-logo.png`: **523 KB**. Sidebar mark `public/aria-mark.png`: **232 KB**.
  `public/brand/mantu-agents-reference.png`: **1439 KB** (reference asset).
- Troika fonts: 4 × `Manrope-*.ttf` @ 94 KB.

---

## Findings

## [MEDIUM] recharts eagerly bundled on the landing route and 3 other data pages
- **Area / Affected**: Bundle size / code-splitting. `src/components/charts/{funnel-chart,trend-spark,score-distribution,score-gauge}.tsx` (all `import ... from "recharts"`); consumed by `src/app/page.tsx` (dashboard/landing) and `src/app/campaigns/[id]/page.tsx` directly, and transitively by `/candidates` and `/reports`.
- **Description**: The chart components import `recharts` statically. Routes that reach them ship First Load JS of **330–361 kB**, vs **217–246 kB** for routes that do not — a **~110 kB** uplift attributable to recharts (and its `d3-*` tree) loaded eagerly. The authenticated **landing route `/` is 333 kB**, so the heaviest dependency is on the first authenticated paint.
- **Impact**: Slower TTI/LCP on the primary console entry and the most-used data views; more JS to parse/execute on mid/low-end devices.
- **Likelihood**: High — every authenticated session lands on `/`.
- **Reproduction**: `npm run build` and compare First Load JS for `/` (333 kB) vs `/chat` (221 kB).
- **Evidence**: Build route table above; `grep -rln recharts src` → 4 chart files; `/` and `/campaigns/[id]` import chart components directly.
- **Recommended fix**: Lazy-load chart components via `next/dynamic(() => import(...), { ssr: false, loading: () => <SkeletonChart/> })` so recharts is a separate chunk fetched only when a chart scrolls into view; or replace small sparklines/gauges with hand-rolled SVG (`trend-spark`, `score-gauge` are tiny and do not need recharts). Add a bundle/perf budget check in CI.
- **Tests to add**: CI assertion on First Load JS for `/` (e.g. fail if > 250 kB); visual regression on charts after dynamic-import.
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Low after split.

## [MEDIUM] Single global context re-renders every consumer on every state change
- **Area / Affected**: Render bottleneck / store subscriptions. `src/lib/store.ts:284` (`createContext`), `:2819-2824` (`value = { state, hydrated, actions }`), selector hooks `:2921-3019` (`useSeats`, `useCandidates`, `useOutreach`, …), all via `useHermes()` → `useContext(HermesContext)` `:2851-2855`.
- **Description**: There is exactly **one** context value object holding the entire `HermesState`. It is re-created whenever `state` changes (`useMemo(..., [state, actions])`). Every component that calls **any** selector hook subscribes to that single context and therefore **re-renders on every mutation anywhere in the store** — there is no `useSyncExternalStore` with a selector, no context splitting, and no `use-context-selector`. Worse, several selectors allocate new arrays each render and defeat downstream memoization: `usePendingApprovals` (`:2966` `.filter`), `useCampaignCandidates` (`:2947` `.filter`), `useCampaignOutreach` (`:2961`), `useDashboardKpis` (`:2995` recomputes `globalKpis(state)`).
- **Impact**: At production data volumes (hundreds of candidates/outreach/ledger rows, live 600 ms autosave loop), any single edit (e.g. approving one message) re-renders the entire mounted tree, causing input lag / dropped frames (poor INP).
- **Likelihood**: Medium — negligible at demo scale (4 seats, ~52 candidates per `seed.ts`), material at real scale.
- **Reproduction**: React Profiler on `/candidates` with a large pool while toggling one candidate's stage — observe full-tree commits.
- **Evidence**: `store.ts` lines cited; no `useSyncExternalStore` anywhere (`grep` → 0).
- **Recommended fix**: Split into a stable **actions context** (already memoized, never changes) + a **state store** exposed via `useSyncExternalStore(subscribe, () => selector(state))` (or `zustand`/`use-context-selector`) so components only re-render on the slice they read. Memoize derived selectors (`globalKpis`, filtered lists) with stable inputs.
- **Tests to add**: Render-count assertion (why-did-you-render or a test harness) proving a single-field mutation does not re-render unrelated subtrees.
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Medium until refactored.

## [MEDIUM] Whole-state synchronous persistence on every mutation
- **Area / Affected**: Render/main-thread bottleneck, unnecessary work. `src/lib/store.ts:401-421`.
- **Description**: The persist effect runs on every `state` change. In **demo mode** it does a **synchronous** `window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))` of the **entire workspace blob** on the main thread, every mutation (`:414-419`). In **live mode** it is 600 ms-debounced but still a **full-document** upsert of the whole `state` snapshot (`:411-413`, `saveRemoteState`).
- **Impact**: `JSON.stringify` of the full workspace grows O(n) with candidates/outreach/ledger/chat history; at scale this blocks the main thread on every keystroke-driven mutation (e.g. editing a draft, classifying replies), hurting INP. Live mode pushes the whole document over the wire each save.
- **Likelihood**: Medium (scale-dependent).
- **Reproduction**: Grow `localStorage` blob to a few MB and edit a field; observe serialize cost in a performance trace.
- **Evidence**: `store.ts:401-421`.
- **Recommended fix**: Debounce demo persistence too (e.g. 300–600 ms, idle-callback), persist via a structured store with per-slice diffing, and move serialization off the main thread (Web Worker or `requestIdleCallback`). For live mode, send patches rather than the whole document. Also clear the pending save timer on provider unmount.
- **Tests to add**: Benchmark serialize time vs blob size; assert persistence is debounced (not per-mutation).
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Medium until diffed/debounced.

## [MEDIUM] Login (entry) route ships a 523 KB unoptimized image + autoplay CloudFront video
- **Area / Affected**: Image optimization, Core Web Vitals (LCP/CLS), unnecessary network. `src/app/login/page.tsx:134` (raw `<img src="/aria-logo.png">`, 523 KB), `:116-125` (`<video autoPlay loop muted>` from CloudFront `:11-12`), `:6` framer-motion (page bundle **41.4 kB**).
- **Description**: The login hero renders the **523 KB** logo via a raw `<img>` (the `@next/next/no-img-element` lint is explicitly disabled at `:133`): **no** `next/image` optimization, **no** `width`/`height` (layout-shift/CLS risk), no responsive `srcset`/webp. It also autoplays a background **`.mp4` from `d8j0ntlcm91z4.cloudfront.net`** with `poster=""` (empty) and no `preload` hint, so a large media fetch competes with first paint on the unauthenticated entry page.
- **Impact**: Heavy LCP element + CLS on the page every visitor hits first; large data transfer (logo + video) before sign-in.
- **Likelihood**: High (every login).
- **Reproduction**: Load `/login` on a throttled connection; observe logo bytes and video buffering.
- **Evidence**: `login/page.tsx:11-12, 116-125, 133-134`; `stat` → `aria-logo.png` 523 KB.
- **Recommended fix**: Convert the logo to `next/image` (or an SVG) with explicit dimensions and `priority`; add a lightweight `poster` frame and `preload="none"`/intersection-gated playback for the video, or a static poster image fallback; consider a smaller/transcoded video. Re-compress `aria-logo.png` (a transparent wordmark should be a few KB as SVG/optimized PNG).
- **Tests to add**: Lighthouse on `/login` (LCP/CLS budget); asset-size check on `aria-logo.png`.
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Low after conversion.

## [MEDIUM] Dead 3D scene subtree + 22 MB of unused 3D assets shipped
- **Area / Affected**: Dead code, deploy/asset bloat, dependency surface, foot-gun. `src/components/floor3d/Floor3DScene.tsx` (611 lines) and its subtree: `CityWorld.tsx`, `OfficeRoom.tsx`, `OfficeFurniture.tsx`, `InstancedAgents.tsx`, `SpriteCharacter.tsx`, `RobotCharacter.tsx`, `RiggedCharacter.tsx`; assets under `public/office3d/`.
- **Description**: The active floor path is `floor/page.tsx:43` → `Floor3D.tsx` → `retro/RetroOfficeScene.tsx` (+ `AgentModel`, `RetroEnvironment`). **`Floor3DScene.tsx` is never imported** (`grep -rn Floor3DScene src` → only self-references and one comment in `InstancedAgents.tsx`). That dead subtree is the **only** consumer of `@react-three/postprocessing` + `postprocessing` (`Floor3DScene.tsx:4`, `grep -rn postprocessing src` → 1 hit) and the **only** consumer of the **6 character sprite PNGs ~13.4 MB** (`SpriteCharacter.tsx:14-19`, dead). Large GLBs (`wooden_table` 3.5 MB, `biz_man` 1.5 MB, `sofa_chair` 1.3 MB, `man`, `employee`) are not referenced by the active scene. `public/office3d` totals **22 MB**.
- **Impact**: Tree-shaking keeps the dead **JS** out of route bundles (it is never imported), so runtime JS is not currently inflated — but **the entire 22 MB `public/` directory is deployed wholesale**, `postprocessing` stays in `node_modules`/lockfile/audit surface, and the dead `.tsx` is a latent foot-gun: re-importing `Floor3DScene` would silently ship Bloom/EffectComposer + 13 MB of sprites. It is also pure maintenance burden and confuses the asset register.
- **Likelihood**: Medium (deploy size today; runtime risk only if re-wired).
- **Reproduction**: `grep -rn Floor3DScene src`; `grep -rn postprocessing src`; `du -sh public/office3d`.
- **Evidence**: import map above; `package.json` lists `@react-three/postprocessing` + `postprocessing` as deps.
- **Recommended fix**: Delete the dead scene subtree and its exclusive assets (6 character PNGs, unused GLBs), and drop the two `postprocessing` packages from `package.json`. If kept for a future feature, move assets out of `public/` (not auto-deployed) and document them. Re-verify with the build afterwards.
- **Tests to add**: A lint/CI rule (e.g. `knip`/`ts-prune`) to flag unused modules and unreferenced `public/` assets.
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Low after removal.

## [MEDIUM] No list virtualization on candidate (and other) tables
- **Area / Affected**: Render bottleneck at scale. `src/components/candidates/candidate-table.tsx:90` (`candidates.map(...)`), `src/app/candidates/page.tsx:57-73, 145-153` (filter/sort then render all).
- **Description**: The candidate table renders **every** filtered row; there is no pagination, windowing, or virtualization (`grep` → no `react-window`/`react-virtual`/`IntersectionObserver` anywhere). Combined with the global-context re-render (above), a large pool re-renders all rows on any store change.
- **Impact**: Fine at the **~52 seeded candidates** (`seed.ts` counts 22+18+12), but a real workspace that sources thousands of candidates renders thousands of DOM rows + full re-renders → slow scroll, high INP, memory growth.
- **Likelihood**: Medium (scale-dependent).
- **Reproduction**: Seed several thousand candidates; scroll `/candidates`.
- **Evidence**: cited lines; no virtualization libs imported.
- **Recommended fix**: Add windowing (`@tanstack/react-virtual`) or server/client pagination for candidate/outreach/ledger lists; pair with the store-subscription refactor.
- **Tests to add**: Perf test rendering N=5000 rows under a frame-budget.
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Medium at scale.

## [LOW] Global external fonts loaded render-blocking on every route (incl. 3rd-party host)
- **Area / Affected**: Render-blocking resources, availability/privacy, Core Web Vitals. `src/app/layout.tsx` `<head>` — `fonts.googleapis.com` (Geist) and **`db.onlinewebfonts.com`** (Garamond) `<link rel="stylesheet">`.
- **Description**: Two external font stylesheets load **app-wide** via `<link>` although the comment notes they are the "cinematic login hero fonts" — i.e. needed only on `/login`. `next/font` is not used (`grep -rn next/font src` → 0), so fonts are not self-hosted/optimized; `db.onlinewebfonts.com` is an uncontrolled third party (availability + privacy dependency) and is even allow-listed in CSP (`next.config.mjs`). The build log shows Next attempting (and skipping, offline) Google-Font optimization.
- **Impact**: Extra render-blocking request + third-party connection on every page; FOUT/CLS risk; availability coupling to a third-party font CDN.
- **Likelihood**: High (every page) / impact Low.
- **Evidence**: `layout.tsx` head; `next.config.mjs` CSP `style-src`/`font-src` entries; build warning.
- **Recommended fix**: Self-host via `next/font/local` (or `next/font/google`) and scope the hero fonts to the `/login` segment only; drop the `db.onlinewebfonts.com` dependency.
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Low.

## [LOW] No long-lived cache headers for `public/` static assets (GLBs, fonts, PNGs)
- **Area / Affected**: Caching. `next.config.mjs` `headers()` (security headers only), `vercel.json` (HSTS only at `:31`).
- **Description**: `_next/static/*` is automatically immutable-cached by Next, but assets under `public/` (the office GLBs, Manrope TTFs used by troika, brand/logo PNGs) are served with Next's default short cache and are **not** content-hashed, so repeat visits to `/floor` revalidate each GLB/font.
- **Impact**: Extra revalidation round-trips on repeat 3D-floor visits; minor.
- **Evidence**: no `Cache-Control` for `/office3d` in `next.config.mjs`/`vercel.json`.
- **Recommended fix**: Add a `headers()` rule for `/office3d/:path*` (and other stable public assets) with `Cache-Control: public, max-age=31536000, immutable` (version the path on change).
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Low.

## [LOW] Oversized image sources behind `next/image` (priority-preloaded on every page)
- **Area / Affected**: Image optimization. `src/components/app/logo.tsx` (`aria-mark.png` 232 KB rendered at ~36–40 px tall, `priority`, used in sidebar/topbar on every authenticated page).
- **Description**: `next/image` will downscale and serve webp/avif at runtime, so the **wire payload is small**, but the **source PNG is oversized** (232 KB for a ~40 px mark) and two instances use `priority` (double preload). The optimizer also depends on `sharp` when self-hosted (no `images` block in `next.config.mjs`).
- **Impact**: Optimizer CPU/cost and an oversized origin asset; minimal client impact thanks to `next/image`.
- **Evidence**: `logo.tsx`; `stat` → 232 KB; `next.config.mjs` has no `images` config.
- **Recommended fix**: Replace the mark with an inline SVG or a correctly-sized PNG; reserve `priority` for the single above-the-fold instance; confirm `sharp` is available in the deploy target.
- **Status**: OPEN / **Owner**: Frontend / **Residual risk**: Low.

## [UNKNOWN] Core Web Vitals (LCP / INP / CLS) are unmeasured
- **Area / Affected**: Core Web Vitals, performance budget. Whole app.
- **Description**: No Lighthouse/PageSpeed run, no field/RUM data (`web-vitals`, Vercel Analytics, Speed Insights — none present), and no perf budget in CI (`.github/workflows/ci.yml`). This audit measured **bundle sizes** (build) and **code-level risks**, but actual LCP/INP/CLS cannot be verified without a running/deployed instance.
- **Impact**: Cannot assert the app meets WCAG-adjacent UX/perf expectations or Core Web Vitals thresholds.
- **Blocked on**: A running/deployed instance (or authorized local run with a headless browser/Lighthouse) + a decision to add RUM.
- **Recommended fix**: Add `@vercel/speed-insights` or a `web-vitals` reporter; run Lighthouse CI against a preview deploy with budgets (LCP < 2.5 s, INP < 200 ms, CLS < 0.1, JS budget per route).
- **Status**: UNKNOWN.

---

## Verified-good (PASS) controls — keep these

## [PASS] 3D floor is correctly code-split and excluded from First Load JS
- **Evidence**: `src/app/floor/page.tsx:43` `const Floor3D = dynamic(() => import("@/components/floor3d/Floor3D"), { ssr: false })`. In the build, `/floor` First Load JS is **233 kB** — `three`/`@react-three/fiber`/`@react-three/drei` are **not** in any route's First Load JS; they load only when the user switches to 3D mode (`floor/page.tsx:146` gates rendering on `viewMode === "3d"`). GLB/texture preloads (`useGLTF.preload`, `useTexture.preload`) run at module scope and therefore only after the dynamic import. The active scene caps full-detail agents at **48** with an honest UI note (`floor/page.tsx:222-231`).

## [PASS] 3D render loop is allocation-light and leak-free at the React layer
- **Evidence**: Animation is **ref-based with no React state per frame**. `retro/systems/agentTick.ts:203` runs one `useFrame` that mutates `renderAgentsRef`/`renderAgentLookupRef` (refs), and each `AgentModel` (`retro/objects/AgentModel.tsx:107`) reads its agent from the ref and mutates `groupRef`/mesh transforms directly — no `setState` in any `useFrame` (`grep useFrame src` → all in floor3d, none call store setters). Canvas caps `dpr={[1, min(devicePixelRatio, 1.5)]}` and shadow map at 1024 (`RetroOfficeScene.tsx:54-61, 110`). Timers elsewhere are cleaned up (`reply-card.tsx:47-48` `clearInterval`; `drawer/modal/command-search` clear their timeouts). The Canvas unmounts (and r3f disposes) when the user leaves 3D mode. **Minor, non-blocking**: `agentTick` allocates a new agent array + Map and spreads N objects **per frame** (`agentTick.ts:206, 286`) and `AgentModel` does a per-frame `agentId.split("").reduce(...)` (`:195-197`) — GC pressure that is negligible at N≤48 but worth trimming if the agent cap rises.

## [PASS] framer-motion is scoped, not global
- **Evidence**: `grep -rln framer-motion src` → **only** `src/app/login/page.tsx`. It is not pulled into the shared/app bundle; it shows up only as the `/login` page-bundle weight (41.4 kB).

---

## Gate decision

**Gate 3 — Frontend (frontend-perf part): FAIL.**

| Sub-check | Status | Evidence / blocker |
|---|---|---|
| 3D floor code-splitting | **PASS** | `floor/page.tsx:43` dynamic `ssr:false`; `/floor` First Load 233 kB excludes three/r3f/drei |
| 3D render-loop memory profile | **PASS** | ref-based `useFrame` (agentTick.ts:203, AgentModel.tsx:107); timers cleaned; dpr/shadow capped |
| framer-motion scoping | **PASS** | only `/login` imports it |
| Bundle size / code-splitting (charts) | **FAIL** | recharts eager → `/` 333 kB, `/campaigns/[id]` 361 kB (~110 kB delta) |
| Render bottlenecks / store subscriptions | **FAIL** | single context re-renders all consumers (store.ts:284, 2819); whole-state persist per mutation (store.ts:401-421) |
| Image optimization | **FAIL** | 523 KB raw `<img>` on `/login` (login/page.tsx:134); oversized PNG sources |
| Dead code / asset bloat | **FAIL** | `Floor3DScene` subtree unused; 13.4 MB sprites + unused `postprocessing`; 22 MB `public/office3d` |
| List virtualization | **FAIL (at scale)** | no windowing/pagination (candidate-table.tsx:90) |
| Caching (static assets) | **FAIL/PARTIAL** | no long cache for `public/` GLBs/fonts; HSTS only |
| Font loading | **PARTIAL** | external app-wide `<link>` fonts incl. 3rd-party host; no `next/font` |
| Core Web Vitals (LCP/INP/CLS) | **UNKNOWN** | no Lighthouse/RUM; blocked on running/deployed instance |

No CRITICAL/HIGH frontend-perf findings, but multiple evidenced **open MEDIUM** defects plus
**unmeasured Core Web Vitals** preclude a PASS. Per the operating rules (unknown/untested = not
PASS; conservative), the frontend-perf part of Gate 3 is **FAIL**.

### Top fixes, in priority order
1. Lazy-load `recharts` chart components (split off ~110 kB from the landing route and 3 data pages).
2. Convert the 523 KB login logo to optimized `next/image`/SVG with dimensions; gate/poster the hero video.
3. Delete the dead `Floor3DScene` subtree + 13.4 MB sprite PNGs + unused `postprocessing` deps; move/trim `public/office3d` (22 MB).
4. Refactor the store to selector-based subscriptions (`useSyncExternalStore`/zustand) and debounce/diff persistence.
5. Add list virtualization for candidate/outreach/ledger tables.
6. Add `next/font` (self-host, scope hero fonts to `/login`); add long-cache headers for `public/office3d`.
7. Add Lighthouse CI + a per-route JS budget and a RUM reporter to make Core Web Vitals measurable (closes the UNKNOWN).

---

## Cross-references
- `RELEASE_GATE_MATRIX.md` Gate 3 (Frontend/UX/a11y, PARTIAL) and Gate 10 (Performance/reliability,
  FAIL/UNKNOWN — load/SLO/3D-300-agent). This report supplies the **frontend-perf evidence** for Gate
  3 and complements Gate 10's load/SLO gap (which remains separately open).
- `ASSET_REGISTER.md` §3/§6 (repo/asset inventory) — this report adds the **22 MB `public/office3d`**
  bloat + dead-asset detail.
- `ARCHITECTURE.md:154` (3D stack + recharts) — confirms the dependency surface analysed here.
