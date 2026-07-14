# Software Bill of Materials (SBOM) — MSourcing ("hermes-sourcing")

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


- **Component:** MSourcing application (`package.json` name `hermes-sourcing@1.0.0`)
- **Repo:** `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing` (git `main`, **working tree DIRTY**)
- **Generated:** 2026-06-27, manually compiled from `package.json` + `package-lock.json` + `npm ls` + `npm audit`
- **Toolchain at compile time:** Node `v22.22.3`, npm `10.9.8` (note: CI and `vercel.json`/Claw3D Dockerfile target Node **20**; the merge spec targets Node 20/22)
- **Gate mapping:** Gate 7 (Containers/orchestration) + cross-ref Gate 8 (CI/CD/supply chain)

> **Status of this SBOM: PARTIAL / not production-grade.** This is a **human-readable** SBOM compiled from the lockfile. There is **NO machine-readable SBOM artifact** (CycloneDX/SPDX JSON) generated or published by CI, and **NO container OS-layer SBOM**, because no container image is built in this environment and no SBOM tooling (`@cyclonedx/cyclonedx-npm`, syft, `trivy sbom`) is wired in `.github/workflows/*` or `package.json`. Per audit rules, the SBOM gate is therefore **FAIL** until a real CycloneDX/SPDX artifact + image SBOM are produced and attached to releases. See `CONTAINER_SECURITY_REPORT.md` finding "[MEDIUM] No SBOM generation".

---

## 1. Scope & method

- **In scope:** the npm dependency graph of the current MSourcing app (the only deployable artifact today — Vercel serverless `.next`).
- **Out of scope (UNKNOWN — blocked):** container base-image OS packages (Debian `node:20-slim` libs) — there is no built image to scan; the **planned** Claw3D container would add a second, larger npm graph (~Next 16 / React 19 / Phaser / ws — see merge spec §4) plus the Debian OS layer. Both require `syft`/`trivy` on a built image, which is not authorized/available here.
- **Method:** `npm ls --omit=dev --depth=0` (direct prod deps, resolved versions), `package.json` (declared ranges), `package-lock.json` (full pinned graph), `npm audit` (known vulns). All read-only.
- **Total resolved packages in `package-lock.json`:** **575** (`grep -c '"resolved":' package-lock.json`). The list below enumerates **direct** dependencies; the full transitive set is in `package-lock.json` (the authoritative lockfile) and must be emitted as CycloneDX in CI.

---

## 2. Direct production dependencies (resolved versions)

| Package | Declared (`package.json`) | Resolved | Purpose | Notable |
|---|---|---|---|---|
| `next` | ^14.2.35 | **14.2.35** | Framework (App Router, serverless) | **Has open HIGH advisories — see §5** |
| `react` | ^18.3.1 | 18.3.1 | UI runtime | — |
| `react-dom` | ^18.3.1 | 18.3.1 | UI runtime | — |
| `@supabase/ssr` | ^0.5.2 | 0.5.2 | Auth/session (SSR cookies) | Sensitive — auth path |
| `@supabase/supabase-js` | ^2.108.2 | 2.108.2 | DB/auth client | Sensitive — DB + service-role |
| `zod` | ^3.23.8 | 3.25.76 | Input validation | — |
| `@react-three/fiber` | ^8.18.0 | 8.18.0 | 3D renderer (floor) | peer-bound to React/three |
| `@react-three/drei` | ^9.122.0 | 9.122.0 | 3D helpers | — |
| `@react-three/postprocessing` | ^2.19.1 | 2.19.1 | 3D postfx | — |
| `postprocessing` | ^6.39.1 | 6.39.1 | 3D postfx core | — |
| `three` | ^0.169.0 | 0.169.0 | 3D engine | large native-ish graph |
| `troika-three-text` | ^0.52.4 | 0.52.4 | 3D text | — |
| `recharts` | ^2.13.3 | 2.15.4 | Charts | — |
| `framer-motion` | ^11.11.17 | 11.18.2 | Animation | — |
| `lucide-react` | ^0.456.0 | 0.456.0 | Icons | — |
| `clsx` | ^2.1.1 | 2.1.1 | classNames util | — |
| `tailwind-merge` | ^2.5.4 | 2.6.1 | Tailwind class merge | — |

## 3. Direct development dependencies

| Package | Declared | Purpose |
|---|---|---|
| `typescript` | ^5.6.3 | Types / `tsc --noEmit` |
| `tsx` | ^4.22.4 | Runs the 22 `.mts` test suites |
| `eslint` | ^8.57.1 | Lint |
| `eslint-config-next` | ^14.2.35 | Next lint rules |
| `tailwindcss` | ^3.4.15 | CSS framework |
| `postcss` | ^8.4.49 | CSS pipeline | **transitive copy under `next` is vulnerable — see §5** |
| `autoprefixer` | ^10.4.20 | CSS prefixing |
| `@types/node` | ^20.17.6 | Types |
| `@types/react` | ^18.3.12 | Types |
| `@types/react-dom` | ^18.3.1 | Types |
| `@types/three` | ^0.169.0 | Types |

## 4. Build / runtime / deploy components (current)

| Component | Version / value | Source |
|---|---|---|
| Runtime (CI/Vercel) | Node 20 | `.github/workflows/ci.yml`, `vercel.json` `installCommand: npm ci` |
| Package manager | npm (lockfile v3-style) | `package-lock.json` |
| Deploy platform | Vercel serverless, region `cdg1` | `vercel.json` |
| Build output | `.next` | `vercel.json` `outputDirectory` |
| **Container base (planned)** | `node:20-slim` (unpinned tag) | `ultraplan/claw3d/Dockerfile` |
| **Custom server (planned)** | `node server/index.js` + `ws@8` | merge spec §3.2; `ultraplan/claw3d/` |

---

## 5. Known vulnerabilities (`npm audit`, app deps only)

`npm audit` (run 2026-06-27): **5 vulnerabilities — 4 HIGH, 1 MODERATE.** These are in app dependencies; OS/base-image CVEs are **NOT covered** (no image scan).

| Package | Severity | Advisory (summary) | Fix path |
|---|---|---|---|
| `next` 14.2.35 | HIGH | GHSA-8h8q-6873-q5fj — DoS via Server Components | Upgrade Next (fix = 16.x, breaking) |
| `next` 14.2.35 | HIGH | GHSA-3g8h-86w9-wvmq — Middleware/Proxy redirect cache poisoning | Upgrade Next |
| `next` 14.2.35 | HIGH | GHSA-c4j6-fc7j-m34r — **SSRF via WebSocket upgrades** (directly relevant to the planned `/api/gateway/ws`) | Upgrade Next |
| `next` 14.2.35 | HIGH | GHSA-h64f-5h5j-jqjh — DoS in Image Optimization API (+ several XSS/cache-poison advisories: ffhc-5mcf-pf4q, vfv6-92ff-j949, gx5p-jg67-6x7h, wfc6-r584-vfw7, 36qx-fr4f-26g5) | Upgrade Next |
| `postcss` <8.5.10 (under `next`) | MODERATE | GHSA-qx2v-qp2m-jg93 — XSS via unescaped `</style>` in stringify | Upgrade Next/postcss |

**Notes:**
- CI runs `npm audit --audit-level=high || true` — **non-blocking**, so these ship undetected by the gate (see `CONTAINER_SECURITY_REPORT.md` and Gate 8).
- The `next` fix is a **breaking** major (`npm audit fix --force` → `next@16.2.9`). Notably, the **Claw3D merge plan already targets Next 16.1.7** (merge spec §4), which would remediate these — making the upgrade both a feature and a security driver. Verify the chosen Next 16.x patch is itself clear of open advisories at merge time.
- **Working-tree drift:** `npm ls` flags extraneous local packages (`pgpass`, `postgres-*`, `split2`, `xtend`) not in the lockfile graph. These are local `node_modules` drift (dirty tree), **not** part of the shipped/`npm ci` artifact; resync with `npm ci`.

---

## 6. Planned container additions (Claw3D merge — NOT yet in the shipping artifact)

Per `docs/superpowers/specs/...claw3d-office-merge-design.md` §4, the merged app would add a substantial npm graph and an OS layer that this SBOM does **not** yet cover and that must be re-scanned + re-SBOM'd at merge:

- **New runtime deps:** `next@16.1.7`, `react@19.2.3`, `react-dom@19.2.3`, `phaser@3.90.0`, `ws@8.21.0`, `@noble/ed25519@3.1.0`, `react-markdown@10`, `remark-gfm@4`, `react-mentions-ts@5.4.7`, `canvas-confetti@1.9.4`, `class-variance-authority@0.7.1`, `tailwind-merge@3.6.0`, upgraded r3f9/three0.184/drei10/postprocessing3, `framer-motion@12`, `lucide-react@0.563`.
- **New build/dev deps:** `@playwright/test`, `vitest@4`, `@tailwindcss/postcss@4`, `tw-animate-css`, `selfsigned` (self-signed TLS in the dev server), Tailwind 4, eslint 9.
- **OS layer:** Debian (`node:20-slim` / spec's `node:22-slim`) base packages — **never enumerated** (no image SBOM).
- **Hard version ceilings** (merge spec): `react <19.3`, `three <0.185` (enforced via `overrides`).

---

## 7. SBOM gaps & required actions

| Gap | Severity | Action |
|---|---|---|
| No machine-readable SBOM (CycloneDX/SPDX) | HIGH | Add `cyclonedx-npm`/`@cyclonedx/cyclonedx-npm` to CI; emit `sbom.cdx.json` per build; attach to release. |
| No container OS-layer SBOM | HIGH | `syft`/`trivy sbom` on the built image once the container deploy exists. |
| No SBOM attestation on image | MEDIUM | cosign attach SBOM + SLSA provenance to the pushed image. |
| `npm audit` non-blocking in CI | HIGH | Make `--audit-level=high` blocking for prod; track the open Next advisories to closure (Next 16 upgrade). |
| Transitive graph not enumerated here | INFO | `package-lock.json` (575 pkgs) is authoritative; emit full CycloneDX in CI rather than maintaining this table by hand. |
| Toolchain Node mismatch (local 22 vs CI/target 20) | LOW | Pin a single Node version (target 22 per merge) across CI, Dockerfile, and `engines` in `package.json`. |

---

## 8. Verdict

- **Application SBOM (this document):** **PARTIAL** — direct deps enumerated with evidence; full transitive graph in `package-lock.json` (575 pkgs); **4 HIGH + 1 MODERATE** known npm vulns open (Next.js 14.2.35 + postcss), CI gate non-blocking.
- **Machine-readable + container SBOM:** **FAIL / not produced** — no CycloneDX/SPDX artifact, no image OS-layer SBOM, no attestation.
- **Action to reach PASS:** generate + publish a CycloneDX SBOM in CI for the npm graph and (when the container exists) the image OS layer, attach as a signed attestation, and remediate the open HIGH advisories (Next 16 upgrade) with the audit gate made blocking.

Cross-ref: `production-readiness/CONTAINER_SECURITY_REPORT.md` (Gate 7), `production-readiness/RELEASE_GATE_MATRIX.md` (Gates 7 & 8).
