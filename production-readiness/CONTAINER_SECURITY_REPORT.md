# Container & Orchestration Security Report — MSourcing ("hermes-sourcing")

- **Phase / Gate:** Phase 7 — **Gate 7: Containers / orchestration**
- **Reviewer role:** Container / Orchestration Engineer
- **Repo:** `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing` (git, branch `main`, **working tree DIRTY** — audited as-is)
- **Date:** 2026-06-27
- **Scope rule:** Design/audit only. No app source modified. Read-only evidence commands only (no network beyond npm registry). UNKNOWN/untested = FAIL or UNKNOWN, never PASS.
- **Supersedes:** `RELEASE_GATE_MATRIX.md` row 7 ("UNKNOWN/N-A — No Dockerfile/registry/K8s in repo"). That row is **still directionally correct for the current Vercel deploy** but is now **incomplete**: a vendored container deploy target (Claw3D) is present in-tree under `ultraplan/claw3d/` and is the documented forward plan. This report adds that evidence.

---

## 1. Executive summary

**There is no container or orchestration in the *shipping* MSourcing application today.** The app deploys as **Vercel serverless** (`vercel.json` → `"framework": "nextjs"`, region `cdg1`, `buildCommand: npm run build`, `installCommand: npm ci`, `outputDirectory: .next`). No `Dockerfile`, `docker-compose`, `.dockerignore`, Kubernetes manifest, Helm chart, Terraform, or container registry config exists at the repo root or anywhere under `src/`. For the **current** deploy model, Gate 7 is **Not-Applicable** (there is nothing to containerize or orchestrate), so it cannot be a PASS or a FAIL — it is **N/A-now**.

**However, a containerized deploy is an explicit, locked, near-term plan.** The design spec `docs/superpowers/specs/2026-06-27-claw3d-office-merge-design.md` records decision **D2 = "Custom Node server + Docker (adopt Claw3D `server/index.js`; leave Vercel serverless)"**. The full Claw3D product — including a **working `Dockerfile`, `.dockerignore`, and custom Node server** — is **already vendored into the repo** at `ultraplan/claw3d/` (a nested clone of `github.com/iamlukethedev/Claw3D.git`, pinned at commit `eeb6f31`, 2026-05-30, MIT). The merge spec §3.2 / §5-P5 states the merged repo will ship a "multi-stage Dockerfile (Node 22-slim) adapted from Claw3D's" and that CI will "build + push an image."

I therefore audited the Claw3D `Dockerfile` and Node server as the **pre-stage requirements** for the planned deploy. **As written, that Dockerfile does not meet production container-hardening baselines:** it **runs as root** (no `USER`), uses an **unpinned floating base tag** (no digest), has **no `HEALTHCHECK`**, and there is **no image-vulnerability scan, no SBOM, and no container build in CI**. Additionally, MSourcing's repo root has **no `.dockerignore`**, so a naive merged build context would bake the real `.env.local` (present in the working tree, 506 B) and the nested `ultraplan/claw3d/.git` into the build. None of this is exploitable today (no image is built or deployed), but every item is an **OPEN pre-stage blocker** the moment the Claw3D merge proceeds.

**Gate 7 verdict: UNKNOWN — current deploy is containerless (N/A-now); the planned container deploy target exists in-tree but fails hardening baselines and has never been built, scanned, or run.** Conservatively NOT a PASS.

### CIS Docker Benchmark / NIST snapshot (planned Claw3D image, as written)

| Control | Baseline | Status | Evidence |
|---|---|---|---|
| Run as non-root user | CIS 4.1 | **FAIL** | `ultraplan/claw3d/Dockerfile` runner stage has no `USER` → runs as UID 0 |
| Pin base image by digest | CIS 4.x / supply chain | **FAIL** | `FROM node:20-slim` (floating tag, no `@sha256`) |
| `HEALTHCHECK` defined | CIS 4.6 | **FAIL** | No `HEALTHCHECK` in Dockerfile (app has `/api/health` endpoint, unused by image) |
| No secrets baked into image | CIS 4.10 | **PARTIAL/PASS** | `.dockerignore` excludes `.env*` + `.git`; multi-stage discards builder; only non-secret `NEXT_PUBLIC_GATEWAY_URL` baked — **but not verifiable until image built**; **MSourcing root has no `.dockerignore`** |
| Multi-stage / minimal layers | best practice | **PASS** | 3 stages (`deps`/`builder`/`runner`); prod-only `node_modules` via `--omit=dev` |
| Disable install scripts | supply chain | **PASS** | `npm ci --ignore-scripts` in both `deps` and `builder` |
| Image vulnerability scan in CI | NIST SSDF PW.4 / CIS | **FAIL** | No Trivy/Grype/Scout; image never built in `.github/workflows/ci.yml` |
| SBOM generated & published | NIST SSDF PS.3 / EO 14028 | **FAIL** | No syft/cyclonedx; see `SBOM.md` |
| Init / PID-1 signal handling | reliability | **FAIL** | `CMD ["node", "server/index.js"]`; no tini/dumb-init; no `SIGTERM` drain in `server/index.js` |
| Read-only rootfs / cap-drop / resource limits | CIS 5.x | **UNKNOWN — blocked** | No compose/k8s/runtime spec exists to review |
| Image signing / provenance attestation | SLSA / CIS | **FAIL** | No cosign/SLSA provenance for the planned image |

---

## 2. Gate decision

**Gate 7 — Containers / orchestration: UNKNOWN (NOT PASS).**

- **Current production model (Vercel serverless):** containers/orchestration are **N/A-now**. There is no container surface to attack, harden, or operate. This is the correct present-state answer and is unchanged from the prior `RELEASE_GATE_MATRIX.md`.
- **Planned production model (Claw3D Node-server + Docker, decision D2):** **FAIL / UNKNOWN.** A Dockerfile target exists in-tree (`ultraplan/claw3d/Dockerfile`) but (a) does not meet non-root / pinned-base / healthcheck / scan / SBOM baselines, and (b) has **never been built, scanned, or run** in this environment, so its final-image contents and runtime posture cannot be verified.
- **Blocked on:** (1) go/no-go on the Claw3D merge; (2) a hardened, merged Dockerfile + root `.dockerignore`; (3) authorized container build + image scan + SBOM generation in CI; (4) a chosen runtime host (Fly.io / Render / ECS / k8s) with its security spec (non-root, read-only rootfs, cap-drop, resource limits, network policy) to review.

Per operating rules (UNKNOWN/untested = never PASS), Gate 7 is recorded **UNKNOWN**, with the forward plan's open items enumerated below so they are tracked rather than discovered at merge time.

---

## 3. Current-state evidence (containerless / Vercel serverless)

- **No container/IaC files anywhere** (excluding `node_modules`, `.git`, `.playwright-mcp/` snapshots): `find` for `Dockerfile* / *compose* / .dockerignore / Chart.yaml / *.tf / k8s|helm|kustomize` returns **only** `ultraplan/claw3d/Dockerfile` + `ultraplan/claw3d/.dockerignore` (the vendored forward target) and unrelated `*.yml` Playwright snapshots + `supabase/config.toml`.
- **Deploy = Vercel serverless** — `vercel.json`: `"framework": "nextjs"`, `"regions": ["cdg1"]`, `"buildCommand": "npm run build"`, `"installCommand": "npm ci"`, `"outputDirectory": ".next"`. Security headers (CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS) set in both `vercel.json` and `next.config.mjs`.
- **CI** (`.github/workflows/ci.yml`): Node 20, `npm ci` → typecheck → lint → test → `npm run build` → `npm audit --audit-level=high || true` (**non-blocking**) → gitleaks. **No container build step, no image scan, no SBOM step.** (`codeql.yml` adds CodeQL static analysis — not container-related.)
- **Conclusion:** the runtime is a managed-serverless platform; OS image, kernel, base packages, and orchestration are Vercel's responsibility and are **out of scope for repo-level container review** (and there is no authorized access to inspect Vercel's runtime). Container hardening of the *current* app is therefore **N/A**, not PASS.

---

## 4. Forward-plan evidence (Claw3D Node-server + Docker)

Vendored target: `ultraplan/claw3d/` — nested git repo, remote `github.com/iamlukethedev/Claw3D.git`, HEAD `eeb6f31f06c6c9a9f32bf359339fe547d5b92c47` (2026-05-30), `LICENSE` = MIT. Local `SECURITY_HARDENING.md` documents fixes applied on top of upstream (telemetry removed, constant-time token compare, auth rate-limit, WS frame validation, upstream allowlist, media symlink rejection) → **the vendored copy is a locally modified fork, not pristine upstream.**

`ultraplan/claw3d/Dockerfile` (verbatim structure):
- `deps` stage: `node:20-slim`, `npm ci --ignore-scripts --omit=dev`.
- `builder` stage: `node:20-slim`, `npm ci --ignore-scripts`, `COPY . .`, `NEXT_TELEMETRY_DISABLED=1`, `NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789`, `npm run build`.
- `runner` stage: `node:20-slim`, `NODE_ENV=production`, copies `.next` / `public` / `server` / `node_modules` (from `deps`) / `package.json` / `next.config.ts`, `EXPOSE 3000`, `CMD ["node", "server/index.js"]`.
- `.dockerignore`: excludes `node_modules .next .git .cursor .DS_Store npm-debug.log test-results coverage *.tsbuildinfo .env .env.local .env.development .env.production`.

Server entry `ultraplan/claw3d/server/index.js` + `server/network-policy.js`:
- `resolveHosts()` defaults to `["127.0.0.1","::1"]` when `HOST` unset.
- `assertPublicHostAllowed()` **throws** if binding a public host (incl. `0.0.0.0`/`::`) **without** `STUDIO_ACCESS_TOKEN`.
- No `process.on("SIGTERM"|"SIGINT")` handler → no graceful drain of HTTP/WebSocket connections on shutdown.

---

## 5. Findings

## [HIGH] Planned container image runs as root (no non-root USER)
- **Area / Affected:** `ultraplan/claw3d/Dockerfile` runner stage (forward deploy target per merge decision D2).
- **Description:** The `runner` stage sets no `USER`. `node:20-slim` defaults to `root` (UID 0), so the Next.js app and the custom Node server (which terminates a WebSocket proxy that bridges browser → Hermes runtime) run as root inside the container.
- **Impact:** Any RCE / deserialization / path-traversal in the app or its 575-package dependency graph executes as root in the container; combined with a writable rootfs or a host mount it materially raises blast radius and aids container escape. Violates CIS Docker 4.1, NIST CSF PR.AC, ASVS V14.
- **Likelihood:** Medium once deployed (Node app + broad deps + a network-facing WS proxy handling untrusted frames).
- **Reproduction:** `grep -n USER ultraplan/claw3d/Dockerfile` → no match. Build + `docker run ... id` would report `uid=0(root)`.
- **Evidence:** `ultraplan/claw3d/Dockerfile` (runner stage, no `USER` directive).
- **Recommended fix:** Add a non-root user in the runner stage (e.g. `USER node`, which `node:*-slim` already provides as UID 1000), `chown` the copied app dir to it, ensure `/app` and any writable paths (`.certs/`, cache) are writable by that UID, and run the orchestrator with `read-only` rootfs + `--cap-drop=ALL` + `no-new-privileges`.
- **Tests to add:** CI assertion that the built image's default user is non-root (`docker inspect` / Trivy `--security-checks config` / Dockle CIS check); fail the build if UID 0.
- **Status:** OPEN. **Owner:** Tony / merge author. **Residual risk:** none today (no image); HIGH at first container deploy if unaddressed.

## [HIGH] No root-level `.dockerignore` → merged build context would bake `.env.local` and a nested `.git` into the image
- **Area / Affected:** MSourcing repo root (no `.dockerignore`); interaction with the planned merged Dockerfile's `COPY . .` builder step.
- **Description:** MSourcing root has **no `.dockerignore`**. The Claw3D Dockerfile uses `COPY . .` in the builder stage. When the Dockerfile is adapted into MSourcing root (merge spec §3.1 places `Dockerfile` at repo root), a build context that lacks an MSourcing-tuned `.dockerignore` would copy `.env.local` (present, 506 B — real local secrets), `.env.production.example` (4.5 KB), the entire vendored `ultraplan/claw3d/.git`, `backups/`, `production-readiness/`, `.playwright-mcp/`, and ~30 MB of `*.png` screenshots into the builder layer. Even though the multi-stage runner copies only `.next`/`public`/`server`/`node_modules`, secrets present at build time can leak into the `.next` output (Next inlines `NEXT_PUBLIC_*` and can capture env during build) and the builder layer itself persists in any non-squashed cache/registry.
- **Impact:** Secret exposure (Supabase service-role key, OAuth client secrets, RESEND/SENDGRID keys, Hermes API key) in image layers; bloated context; supply-chain leakage of the nested upstream git history.
- **Likelihood:** High if the Claw3D `.dockerignore` is copied as-is (it is tuned for Claw3D's root, not MSourcing's) or omitted.
- **Reproduction:** `ls -la .dockerignore` at MSourcing root → "No such file or directory"; `.env.local` present at root.
- **Evidence:** repo root listing (no `.dockerignore`; `.env.local` 506 B present); `ultraplan/claw3d/Dockerfile` builder `COPY . .`.
- **Recommended fix:** Ship a root `.dockerignore` with the merge that excludes at minimum `.env*` (keep only `*.example` if needed), `**/.git`, `ultraplan/`, `production-readiness/`, `backups/`, `.playwright-mcp/`, `*.png`, `node_modules`, `.next`, `coverage`, `test-results`, `*.tsbuildinfo`. Add a CI/Trivy secret-scan of the built image; add a build-arg discipline so no secret env is needed at build time.
- **Tests to add:** Post-build `trivy image --scanners secret` (or `dockle`) gate; CI check that `.dockerignore` excludes `.env*` and `.git`.
- **Status:** OPEN. **Owner:** merge author. **Residual risk:** none today; HIGH at first build if no `.dockerignore`.

## [HIGH] No container image vulnerability scanning and no container build in CI
- **Area / Affected:** `.github/workflows/ci.yml`; planned image.
- **Description:** CI runs `npm audit --audit-level=high || true` (**non-blocking**) + gitleaks + CodeQL, but **never builds a container image** and has **no image/OS-layer vulnerability scan** (no Trivy, Grype, Docker Scout). `npm audit` only covers npm deps, not the base-image OS packages (Debian `node:20-slim` libs), and is non-blocking. The planned deploy (merge spec §5-P5: "CI (container build)") has no scan gate defined.
- **Impact:** A vulnerable base image or OS package (openssl, zlib, glibc, etc.) ships undetected; no gate stops a known-CVE image from being pushed. Violates NIST SSDF PW.4/PW.7, CIS Controls 7/16.
- **Likelihood:** High over time (base images accrue CVEs continuously).
- **Reproduction:** Read `.github/workflows/ci.yml` — no `docker build`, no scan action.
- **Evidence:** `.github/workflows/ci.yml` (no container/scan steps); `npm audit` currently reports **5 vulns (4 high, 1 moderate)** in app deps (Next.js 14.2.35 advisories + postcss) that are not blocking — see `SBOM.md`.
- **Recommended fix:** Add a container-build job to CI that builds the image, runs Trivy/Grype (`--severity HIGH,CRITICAL --exit-code 1`) on the image (OS + libs), runs Dockle/Trivy-config for CIS Docker checks, and makes `npm audit --audit-level=high` blocking for the prod path. Push only on scan pass; sign with cosign and attach SBOM + provenance.
- **Tests to add:** CI image-scan job (fail on HIGH/CRITICAL); Dockle CIS gate.
- **Status:** OPEN. **Owner:** Tony. **Note:** overlaps Gate 8 (CI/CD/supply chain) — owned jointly; tracked here for the container surface. **Residual risk:** none today; HIGH at first image push.

## [MEDIUM] Base image is a floating, unpinned tag (no digest) and Node 20 nears EOL
- **Area / Affected:** `ultraplan/claw3d/Dockerfile` (all three stages `FROM node:20-slim`).
- **Description:** `node:20-slim` is a mutable tag — not pinned to a digest (`node:20-slim@sha256:...`). Builds are non-reproducible and exposed to upstream tag mutation / typosquat-adjacent supply-chain risk. The merge spec §3.2 actually targets **Node 22-slim**, so even the version is unsettled. Node 20 LTS enters maintenance/EOL in the 2026 window — a production image should track an in-support major and pin it.
- **Impact:** Non-reproducible builds; silent base drift; harder incident forensics ("which exact base shipped?"). Violates SLSA build reproducibility / CIS image-provenance expectations.
- **Likelihood:** Medium.
- **Reproduction:** `grep FROM ultraplan/claw3d/Dockerfile` → `FROM node:20-slim AS ...` (no `@sha256`).
- **Evidence:** `ultraplan/claw3d/Dockerfile`.
- **Recommended fix:** Pin `FROM node:22.x-slim@sha256:<digest>` (or distroless `gcr.io/distroless/nodejs22@sha256:...` for the runner), record the digest in the SBOM, and automate digest bumps via Dependabot/Renovate so updates are reviewed PRs, not silent pulls.
- **Tests to add:** CI lint (hadolint rule DL3006/DL3007 — require pinned digest); SBOM diff on base-image change.
- **Status:** OPEN. **Owner:** merge author. **Residual risk:** none today.

## [MEDIUM] No `HEALTHCHECK` in the image; orchestrator liveness/readiness undefined
- **Area / Affected:** `ultraplan/claw3d/Dockerfile`; runtime host (none chosen).
- **Description:** The Dockerfile defines no `HEALTHCHECK`. MSourcing exposes `GET /api/health` (`src/app/api/health/route.ts`, returns 200 + booleans, `Cache-Control: no-store`, no secrets) and the merge keeps MSourcing's health route (dropping Claw3D's) — but nothing wires it as a container/orchestrator probe. The custom server also handles a WS upgrade on `/api/gateway/ws`, whose health is not probed at all.
- **Impact:** Orchestrators cannot detect a hung/half-broken container (e.g. Next handler up but WS proxy/Hermes adapter wedged); failed instances stay in rotation; rollouts can't gate on readiness. Availability/reliability risk (CIS 4.6, NIST CSF DE).
- **Likelihood:** Medium.
- **Reproduction:** `grep -i healthcheck ultraplan/claw3d/Dockerfile` → no match.
- **Evidence:** `ultraplan/claw3d/Dockerfile`; `src/app/api/health/route.ts` (endpoint exists, unused by image).
- **Recommended fix:** Add `HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` (or an orchestrator liveness/readiness probe to `/api/health`); add a deeper readiness check that also verifies the gateway/Hermes adapter state.
- **Tests to add:** Smoke test that `/api/health` returns 200 inside the running container; orchestrator probe config in the deploy manifest.
- **Status:** OPEN. **Owner:** merge author. **Residual risk:** none today.

## [MEDIUM] No SBOM generation or publication for the planned image
- **Area / Affected:** CI; planned image; cross-ref `production-readiness/SBOM.md`.
- **Description:** No SBOM tooling anywhere (no `@cyclonedx/cyclonedx-npm`, syft, Trivy SBOM). NIST SSDF PS.3 and EO 14028 expect a machine-readable SBOM (CycloneDX/SPDX) for every released artifact, plus an OS-layer SBOM for the container. None is produced or attached to releases.
- **Impact:** No fast "are we affected by CVE-X / dependency-Y?" answer during an incident; no provenance record; weakens supply-chain response (CIS 16).
- **Likelihood:** N/A (process gap).
- **Reproduction:** `grep -ri "cyclonedx\|syft\|sbom\|trivy" --include=*.yml --include=*.json .` (excl. node_modules) → no tooling.
- **Evidence:** absence in `.github/workflows/*` and `package.json`; see `SBOM.md` for the manually compiled component list.
- **Recommended fix:** Generate CycloneDX SBOM in CI (`cyclonedx-npm` for the npm graph + `syft`/`trivy sbom` for the image OS layer), attach to the release and as an in-toto/cosign attestation on the pushed image.
- **Tests to add:** CI SBOM-generation step; SBOM freshness check (fails if SBOM is older than the lockfile).
- **Status:** OPEN. **Owner:** Tony. **Residual risk:** none today.

## [MEDIUM] Node runs as PID 1 with no init and no graceful-shutdown handler
- **Area / Affected:** `ultraplan/claw3d/Dockerfile` (`CMD ["node", "server/index.js"]`); `ultraplan/claw3d/server/index.js`.
- **Description:** The runner launches `node` directly as PID 1 with no init (tini/dumb-init). Node as PID 1 does not reap zombie children and has non-default signal semantics. `server/index.js` registers **no** `SIGTERM`/`SIGINT` handler, so on orchestrator scale-down/rollout the process is hard-killed without draining in-flight HTTP requests or the long-lived `/api/gateway/ws` WebSocket connections to the Hermes runtime.
- **Impact:** Dropped/aborted WebSocket sessions and requests on every deploy/rollback; possible zombie accumulation; unclean shutdown complicates blue/green and rollback (cross-ref `ROLLBACK_RUNBOOK.md`). Reliability risk.
- **Likelihood:** Medium-High during routine rollouts.
- **Reproduction:** `grep -n "SIGTERM\|SIGINT\|tini\|dumb-init" ultraplan/claw3d/server/index.js ultraplan/claw3d/Dockerfile` → no match.
- **Evidence:** `ultraplan/claw3d/Dockerfile`; `ultraplan/claw3d/server/index.js` (no signal handler; servers created via `closeServer()` helper that is never wired to a signal).
- **Recommended fix:** Use `tini`/`dumb-init` as ENTRYPOINT **or** add `process.on("SIGTERM"/"SIGINT", ...)` that stops accepting new connections, closes the WS proxy, drains, then exits; set an orchestrator `terminationGracePeriod` consistent with the drain window.
- **Tests to add:** Integration test that a `SIGTERM` to the container closes listeners and exits 0 within the grace window without dropping an active WS frame.
- **Status:** OPEN. **Owner:** merge author. **Residual risk:** none today.

## [MEDIUM] Container HOST binding vs. access-gate: `HOST=0.0.0.0` without `STUDIO_ACCESS_TOKEN` fails closed (boots crash) — forward integration gap
- **Area / Affected:** `ultraplan/claw3d/server/network-policy.js` + `server/index.js`; merge decision D6 (Supabase auth supersedes `STUDIO_ACCESS_TOKEN`).
- **Description:** `resolveHosts()` defaults to loopback when `HOST` is unset; a container reachable from outside must set `HOST=0.0.0.0`. But `assertPublicHostAllowed()` **throws** when binding a public host without `STUDIO_ACCESS_TOKEN`. The merge spec §3.6 / D6 says `STUDIO_ACCESS_TOKEN` is **not used** (Supabase middleware supersedes it). Net effect: a merged container set to `HOST=0.0.0.0` with no `STUDIO_ACCESS_TOKEN` **refuses to bind and crashes on boot**; the only way to make it serve externally is to (a) set a `STUDIO_ACCESS_TOKEN` anyway, or (b) rework the gate. If a deployer "fixes" the crash by setting a throwaway token, the gate may grant a second, weaker auth path alongside Supabase.
- **Impact:** Broken/blocked container deploy at best; an inconsistent/duplicated auth path at worst. The behavior itself is **fail-closed (safe by default)** — the risk is integration breakage and a tempting unsafe workaround.
- **Likelihood:** High at first container boot if not reconciled.
- **Reproduction:** Set `HOST=0.0.0.0`, unset `STUDIO_ACCESS_TOKEN`, run `node server/index.js` → throws "Refusing to bind Studio to public host ... without STUDIO_ACCESS_TOKEN".
- **Evidence:** `ultraplan/claw3d/server/network-policy.js` (`assertPublicHostAllowed`, `resolveHosts` default `127.0.0.1`/`::1`); merge spec D6.
- **Recommended fix:** Decide explicitly during the merge: either (a) keep a real `STUDIO_ACCESS_TOKEN` as defense-in-depth in front of Supabase and document it as required infra config, or (b) adapt the gate so MSourcing's Supabase auth is the recognized gate when binding public hosts. Bind to `0.0.0.0` only behind the platform's TLS-terminating ingress; never expose the raw Node port publicly.
- **Tests to add:** Container boot smoke test asserting the server binds and `/api/health` answers with the intended prod env; auth test confirming external reachability is gated by Supabase, not bypassable.
- **Status:** OPEN. **Owner:** merge author. **Residual risk:** none today.

## [MEDIUM] Vendored third-party full clone with nested git history and local modifications, no submodule/provenance governance
- **Area / Affected:** `ultraplan/claw3d/` (nested `.git`, remote `github.com/iamlukethedev/Claw3D.git`, HEAD `eeb6f31`).
- **Description:** The entire Claw3D upstream is vendored as a **loose nested clone with its own `.git`** (not a git submodule, not a recorded vendoring at a pinned commit in MSourcing's own history), and it has been **locally modified** (`SECURITY_HARDENING.md` documents fixes applied on top of upstream). There is no MSourcing-side lock recording "we depend on Claw3D@eeb6f31 + these deltas." `MSourcing` itself is not even a committed-clean tree (working tree dirty).
- **Impact:** Supply-chain provenance gap: hard to prove what upstream code (and which deltas) will ship in the container; nested `.git` risks leaking upstream history into a build context (see the `.dockerignore` finding); divergence from upstream means upstream security fixes won't auto-apply. CIS Controls 2/16, NIST SSDF PO.3/PS.
- **Likelihood:** Medium.
- **Reproduction:** `cd ultraplan/claw3d && git remote -v && git rev-parse HEAD` → `github.com/iamlukethedev/Claw3D.git`, `eeb6f31...`.
- **Evidence:** nested git remote + HEAD; `ultraplan/claw3d/LICENSE` (MIT); `ultraplan/claw3d/SECURITY_HARDENING.md` (local deltas).
- **Recommended fix:** Convert to a pinned **git submodule** (or a vendored snapshot recorded at a specific commit in MSourcing's lockfile/manifest with a `THIRD_PARTY/` provenance note + MIT attribution), carry local deltas as reviewable patches, and ensure `**/.git` is in `.dockerignore`. Track upstream advisories for the pinned commit.
- **Tests to add:** CI check that the vendored commit matches a recorded pin; license-attribution check.
- **Status:** OPEN. **Owner:** Tony. **Residual risk:** none today.

## [LOW] Planned image is not minimal (Debian base + full prod node_modules; no distroless / `output: standalone`)
- **Area / Affected:** `ultraplan/claw3d/Dockerfile`; `ultraplan/claw3d/next.config.ts`.
- **Description:** Runner uses `node:20-slim` (Debian — ships apt, a shell, and broad libs) and copies the full prod `node_modules` rather than Next's `output: "standalone"` traced subset (`next.config.ts` does not set `output: 'standalone'`). Larger image = larger attack surface + slower pulls.
- **Impact:** More CVE-bearing OS packages and a shell available to an attacker post-RCE; bigger blast radius and pull cost.
- **Likelihood:** Low (hardening / defense-in-depth).
- **Evidence:** `ultraplan/claw3d/Dockerfile` (runner copies `node_modules`); `next.config.ts` (no `output: standalone`).
- **Recommended fix:** Set `output: "standalone"` and copy only `.next/standalone` + `.next/static` + `public`, or move the runner to distroless/chiselled Node; drop the shell from the final stage.
- **Tests to add:** Image-size budget check in CI; Dockle "no shell in final image" (where feasible).
- **Status:** OPEN. **Owner:** merge author. **Residual risk:** minor.

## [LOW] No image signing / provenance attestation (cosign / SLSA) for the planned image
- **Area / Affected:** planned CI image-push.
- **Description:** No cosign signing or SLSA/in-toto provenance attestation is planned for the pushed image; nothing lets the runtime host verify image authenticity/integrity before run.
- **Impact:** Registry-tampering / pull-of-wrong-image risk goes undetected; weakens deploy-time integrity (NIST SSDF PS.2, SLSA).
- **Evidence:** absence in `.github/workflows/*`.
- **Recommended fix:** Sign images with cosign (keyless OIDC), generate SLSA provenance + SBOM attestation, and enforce signature verification at deploy (admission policy / platform setting).
- **Status:** OPEN. **Owner:** Tony. **Residual risk:** minor today.

## [LOW] Working-tree `node_modules` drift (extraneous packages) — image-determinism note
- **Area / Affected:** local `node_modules` vs. `package-lock.json`.
- **Description:** `npm ls --omit=dev --depth=0` reports **extraneous** packages not in the dependency tree (`pgpass`, `postgres-array`, `postgres-bytea`, `postgres-date`, `postgres-interval`, `split2`, `xtend`) — drift in the dirty working tree. The Dockerfile uses `npm ci` (clean, lockfile-faithful), so the **image** is unaffected, but local dev/test runs are not reproducible.
- **Impact:** Local-only non-determinism; could mask a missing/forgotten dependency.
- **Evidence:** `npm ls --omit=dev --depth=0` output (extraneous entries).
- **Recommended fix:** `npm ci` to resync local `node_modules`; treat `npm ci` (not `npm install`) as the only install path everywhere — already true in `vercel.json` and CI.
- **Status:** OPEN (informational). **Owner:** Tony. **Residual risk:** none for the image.

---

## 6. Positives (verified, with evidence)

- **Multi-stage build** (`deps` → `builder` → `runner`) keeps build toolchain out of the final image — `ultraplan/claw3d/Dockerfile`.
- **Install scripts disabled** (`npm ci --ignore-scripts` in both install stages) — strong supply-chain control against malicious `postinstall`.
- **Prod-only deps** in the final image (`--omit=dev` in `deps`, copied to runner).
- **Telemetry disabled** at build + runtime (`NEXT_TELEMETRY_DISABLED=1`).
- **No obvious baked secrets in the Dockerfile as written** — `.dockerignore` excludes `.env*` and `.git`; only the non-secret `NEXT_PUBLIC_GATEWAY_URL` is baked (verifiable conclusively only once the image is built).
- **Documented server hardening** (`ultraplan/claw3d/SECURITY_HARDENING.md`): constant-time token compare (`crypto.timingSafeEqual`, confirmed in `server/access-gate.js`), auth rate-limiting, WS frame-size (256 KB) + rate (30 fps) limits, upstream allowlist (SSRF defense), media symlink rejection — good runtime posture to carry forward.
- **Fail-closed host binding** — `assertPublicHostAllowed` refuses to expose the server publicly without an access token (the integration friction in the MEDIUM finding is the cost of a safe default).
- **MSourcing `/api/health`** exists, returns only booleans + Node version, `no-store` — ready to wire as a probe.

---

## 7. Pre-stage requirements checklist (gate to PASS *if/when* the Claw3D Docker deploy proceeds)

A future Gate-7 PASS requires **all** of the following, each with evidence:

1. [ ] Runner stage runs as **non-root** (`USER node` / dedicated UID), verified via image inspect in CI.
2. [ ] Base image **pinned by digest** (`@sha256`), in-support major (Node 22 per spec), Renovate/Dependabot-managed.
3. [ ] **`HEALTHCHECK`** in the image + orchestrator liveness/readiness probes to `/api/health` (+ gateway readiness).
4. [ ] **No baked secrets** — root `.dockerignore` excludes `.env*`, `**/.git`, `ultraplan/`, `backups/`, screenshots; confirmed by image secret-scan.
5. [ ] **Image vulnerability scan** (Trivy/Grype) in CI, **blocking** on HIGH/CRITICAL; `npm audit --audit-level=high` blocking for prod.
6. [ ] **SBOM** (CycloneDX/SPDX) generated for npm graph **and** image OS layer, attached to the release/image — see `SBOM.md`.
7. [ ] **Init / graceful shutdown** — tini or `SIGTERM` drain; orchestrator grace period set; no dropped WS on rollout.
8. [ ] **HOST/access-gate reconciliation** — D6 decision implemented (Supabase-gated or token-gated), bound only behind TLS ingress.
9. [ ] **Vendored Claw3D** converted to a pinned submodule / recorded provenance with MIT attribution and tracked deltas.
10. [ ] **Image signing + provenance** (cosign keyless + SLSA), verified at deploy.
11. [ ] **Runtime hardening** at the orchestrator: read-only rootfs, `cap-drop=ALL`, `no-new-privileges`, CPU/memory limits, network policy — reviewable manifest required (currently UNKNOWN — blocked on host choice).
12. [ ] **CIS Docker Benchmark** run (Dockle/Trivy-config) clean; results attached as evidence.

Until these exist and are verified, **Gate 7 cannot be PASS.**

---

## 8. What is UNKNOWN — blocked on access / decision

| Item | Why UNKNOWN | What unblocks it |
|---|---|---|
| Final built-image contents (secrets, layers, size) | Image has never been built in this environment | Authorized `docker build` + image inspect/scan |
| OS-layer package CVEs | No image to scan | Trivy/Grype on a built image |
| Runtime container posture (rootfs, caps, limits, netpol) | No compose/k8s/Fly/Render/ECS manifest exists | Chosen host + reviewable deploy manifest |
| Registry security (private? immutable tags? scanning?) | No registry configured | Registry decision |
| Orchestration (scaling, probes, rollout/rollback, secrets injection) | Nothing exists | Host + orchestration spec |
| Whether Claw3D merge proceeds at all | Spec status = "Draft — awaiting spec review" | Go/no-go decision |

---

## 9. Cross-references

- `production-readiness/SBOM.md` — component inventory + dependency-vuln evidence (this report's companion deliverable).
- `production-readiness/RELEASE_GATE_MATRIX.md` — Gate 7 row (superseded/expanded here).
- `production-readiness/DEPLOYMENT_RUNBOOK.md`, `ROLLBACK_RUNBOOK.md` — current Vercel deploy/rollback (container deploy/rollback not yet covered).
- Gate 8 (CI/CD/supply chain) owns the CI image-build/scan/SBOM/signing pipeline jointly with this gate.
- `docs/superpowers/specs/2026-06-27-claw3d-office-merge-design.md` — the forward-plan source of truth (decision D2).
