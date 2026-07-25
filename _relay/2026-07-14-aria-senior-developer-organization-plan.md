---
project: MSourcing / ARIA
plan_id: aria-senior-developer-organization-20260714
status: ready-blocked-on-active-shift-40
plan_owner: codex-gpt-5
execution_model: claude-sonnet-4-6
prepared: 2026-07-14 16:43 EDT
source_design: approved Approach A, navigation plus staged decomposition
---

# ARIA Senior-Developer Repository Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to execute this plan task by task.
> Every execution worker and reviewer must use `claude-sonnet-4-6`. Do not use
> Opus for implementation. Track progress by changing each checkbox only after
> its verification command passes.

**Goal:** Make the ARIA repository easy for a senior full-stack developer to
navigate, remove duplicated test orchestration, typecheck the test estate,
preserve deployment and import contracts, and prove one safe code-decomposition
pattern without mixing the active product work into a structural change.

**Architecture:** Keep public and path-bound entrypoints stable. Add navigation
maps and executable structure contracts first, replace shell-sized test lists
with one declarative manifest, then extract one React-free store domain behind
the existing `src/lib/store.ts` compatibility facade. Large UI and API files
remain at their public paths and receive separate follow-on plans after this
pattern is green.

**Tech stack:** Node 22.x, npm, TypeScript, Next.js 16, React 19, Node test,
`tsx`, ESLint, Supabase/PostgreSQL, Playwright, GitHub Actions, CodeQL, Fly.

## Global constraints

- Target the clean local `main` tip only after shift 40 closes. Never start
  from `origin/main`, commit `7658d65`, release commit `f5868fa`, or the dirty
  OneDrive deploy checkout.
- Do not modify, reset, clean, stash, or switch another agent's worktree.
- Use a new worktree at
  `/Users/tony/.codex/worktrees/msourcing-structure-hygiene` on branch
  `codex/aria-structure-hygiene-20260714`.
- One logical change per commit. No force push, history rewrite, broad rename,
  dependency upgrade, production mutation, or secret read.
- Keep `src/lib/store.ts`, `src/lib/types.ts`, `deploy-fly.sh`,
  `e2e-workflow-test.sh`, Fly TOMLs, Dockerfiles, migrations,
  `production-readiness/`, `_relay/`, and `_agent_state/` at their current
  paths.
- Do not physically move test files in this plan. Existing tests pin relative
  paths, working directories, and source text.
- The approved asset operation is move-only. Do not delete either `Aria/`
  image or `floor-verify.mjs`.
- Do not add `.github/CODEOWNERS` until Tony supplies verified GitHub handles.
  Use role ownership in documentation without inventing people.
- Preserve all server authority, RLS, approval, delivery, memory, candidate,
  and release behavior. Structural work cannot weaken a negative test.
- Use only synthetic test data. No real candidate or client data may enter a
  fixture, screenshot, log, or Relay note.
- Update `_relay/HANDOFF.md` only after the active shift archives it. Never
  archive or rewrite another agent's active baton.
- Graphify is the first navigation step. At plan time the CLI existed, but
  `graphify-out/graph.json` and `graphify-out/wiki/index.md` were absent. Record
  the same fallback if they are still absent at execution time.

---

## Verified planning snapshot

These facts explain the sequence. They are not substitutes for Task 0's fresh
baseline.

- The OneDrive checkout is on `deploy/fly-github-actions` at `d2040b5`, ahead
  2 and behind 12, with unrelated dirty and untracked work.
- PR 3's clean release worktree is at `f5868fa`; all 17 attached checks were
  green, but that branch is not the current product integration source.
- The product integration worktree is
  `/Users/tony/.codex/worktrees/msourcing-campaign-integration`, local `main`
  at committed base `7658d65`, 12 commits ahead of `origin/main`, with 62
  modified and 16 untracked paths. `_relay/HANDOFF.md` names shift 40 as active.
- The active diff contains candidate erasure, agent operational authority,
  framework runtime, database, API, and UI work. It must be completed and
  committed before this plan starts.
- The source graph audit found 375 modules, 1,465 internal import edges, zero
  static cycles, no `src/lib` import from `src/components` or `src/app`, and no
  `src/components` import from `src/app`.
- `src/lib/store.ts` is 6,448 lines and has 93 source consumers.
  `src/lib/types.ts` is 1,358 lines and has 169 incoming source edges. Both are
  compatibility facades, not rename targets.
- The current package scripts contain duplicate canonical executions. The
  clean baseline must recursively expand scripts and derive the exact list;
  no documentation count may be typed by hand.
- A planning-time strict test typecheck found 149 diagnostics across 45 `.mts`
  files. Re-baseline after shift 40 because the active work may change this.
- `tests/docs-truth.mts` reported 33 passes and 4 failures on the active tree.
  The migration tip was `0033_candidate_erasure_authority.sql`.
- `Aria/Aria.png` is byte-identical to
  `public/brand/mantu-agents-reference.png`. `Aria/Logo.png` is unique. Neither
  root image has a tracked consumer.
- Root `floor-verify.mjs` has no tracked consumer and overlaps
  `scripts/floor-screenshots.mts`.

## Named execution roster

| Agent identifier | Responsibility |
|---|---|
| `Sonnet-Integrator` | Worktree, integration, commits, Relay, push |
| `Sonnet-FullStack` | Test runner, store extraction, application code |
| `Sonnet-Docs` | Repository maps, ownership map, current documentation |
| `Sonnet-Security` | Client/server boundaries, command execution, secret safety |
| `Sonnet-QA-Manifest` | Test inventory, manifest parity, duplicate detection |
| `Sonnet-QA-Types` | Strict `.mts` typecheck and fixture corrections |
| `Sonnet-QA-Structure` | Imports, cycles, path contracts, root hygiene |
| `Sonnet-QA-Application` | Store behavior and browser smoke checks |
| `Sonnet-Final-Validator` | Independent final diff and exact-SHA evidence |

One named agent owns each task. Reviewers do not edit the task owner's files.

## Planned file map

### Files created in this plan

| Path | Single responsibility |
|---|---|
| `src/lib/README.md` | Domain ownership and stable facade rules |
| `tests/README.md` | Test groups, commands, environment, and failure policy |
| `scripts/README.md` | Script catalogue and operator-safe invocation map |
| `infra/README.md` | Fly, Docker, workers, Supabase, and agent-framework map |
| `docs/OWNERSHIP.md` | Role ownership and escalation map without guessed handles |
| `docs/assets/brand-source/README.md` | Provenance and use policy for moved source assets |
| `scripts/visual/README.md` | Current and legacy visual verification entrypoints |
| `tests/test-manifest.mjs` | Declarative argv-array test source of truth |
| `scripts/run-test-manifest.mjs` | Fail-closed serial manifest executor |
| `tests/test-manifest-contract.mts` | Completeness, uniqueness, order, and executor contract |
| `tsconfig.tests.json` | Strict test and TypeScript-script typecheck |
| `tests/helpers/import-graph.mts` | Reusable TypeScript import-graph builder |
| `tests/module-boundaries.mts` | Layer, cycle, and client/server dependency contract |
| `src/lib/store/booking-report-actions.ts` | React-free booking/report action factory |
| `tests/store-booking-report-actions.mts` | Behavior contract for the extracted factory |

### Files modified in this plan

| Path | Intended change |
|---|---|
| `README.md` | Current top-level repository map only |
| `docs/README.md` | Link the new local maps and ownership guide |
| `docs/ARCHITECTURE.md` | Add current `infra`, `workers`, rollback, and facade map |
| `docs/TESTING.md` | Manifest commands and strict test typecheck |
| `production-readiness/STATUS.md` | Manifest-derived test truth only |
| `production-readiness/DEPLOYMENT_RUNBOOK.md` | Manifest-derived test truth and current migration tip |
| `package.json` | Short compatibility commands backed by the manifest |
| `scripts/run-tests-sandbox.mjs` | Compatibility wrapper around the fail-closed runner |
| `tests/docs-truth.mts` | Derive counts from the manifest and check map links |
| `tests/repository-hygiene.mts` | Assert root cleanup and moved-asset provenance |
| `tests/store-contracts.mts` | Import shared graph helper, preserve public facade checks |
| `src/lib/store.ts` | Compose booking/report factory, keep exports and hooks stable |
| `.github/workflows/ci.yml` | Add strict test typecheck after it reaches zero |
| `_relay/codex-findings.md` | Record and close only findings proven by this plan |
| `_relay/HANDOFF.md` | Fresh shift snapshot at each completed milestone |

### Files moved without deletion

| From | To |
|---|---|
| `Aria/Aria.png` | `docs/assets/brand-source/mantu-agents-reference-source.png` |
| `Aria/Logo.png` | `docs/assets/brand-source/aria-logo-source.png` |
| `floor-verify.mjs` | `scripts/visual/legacy-floor-verify.mjs` |

---

## Phase 0: Safe start and exact baseline

### Task 0.1: Wait for shift 40 and create the isolated worktree

**Owner:** `Sonnet-Integrator`  
**Duration:** 30 minutes  
**Dependencies:** None  
**Deliverable:** Clean worktree created from the then-current clean local
`main` tip, with its base SHA recorded in this plan's execution ledger.

- [ ] **Step 1: Read the current coordination sources**

Run from the integration worktree:

```bash
INTEGRATION=/Users/tony/.codex/worktrees/msourcing-campaign-integration
cd "$INTEGRATION"
sed -n '1,260p' AGENTS.md
sed -n '1,260p' _relay/HANDOFF.md
rg -n '\*\*Status:\*\* open' _relay/codex-findings.md
```

Expected: the files exist and no command prints a secret value.

- [ ] **Step 2: Apply the active-shift stop gate**

```bash
test -z "$(git status --porcelain)" || {
  echo 'STOP: integration worktree still contains active work'
  exit 1
}

if rg -n '^## Shift 40 in progress' _relay/HANDOFF.md; then
  echo 'STOP: shift 40 has not archived and closed its baton'
  exit 1
fi
```

Expected before this plan is executable: both guards exit 0. If either guard
fails, update only the standalone plan status and stop. Do not edit product
files or the active baton.

- [ ] **Step 3: Attempt Graphify navigation**

```bash
graphify query "ARIA repository organization, test orchestration, store facades, and path contracts" --budget 2400
```

Expected: a graph answer, or the exact missing-graph error recorded in the new
baton. If the graph is absent, inspect `graphify-out/wiki/index.md`; if that is
also absent, use raw source and record the fallback.

- [ ] **Step 4: Create the worktree from clean local main**

```bash
INTEGRATION=/Users/tony/.codex/worktrees/msourcing-campaign-integration
TARGET=/Users/tony/.codex/worktrees/msourcing-structure-hygiene
BRANCH=codex/aria-structure-hygiene-20260714

cd "$INTEGRATION"
git fetch origin --prune
BASE=$(git rev-parse main)
git merge-base --is-ancestor origin/main "$BASE"
! git show-ref --verify --quiet "refs/heads/$BRANCH"
test ! -e "$TARGET"
git worktree add -b "$BRANCH" "$TARGET" "$BASE"
cd "$TARGET"
test "$(git rev-parse HEAD)" = "$BASE"
test -z "$(git status --porcelain)"
printf '%s\n' "$BASE"
```

Expected: a clean worktree and one printed 40-character base SHA.

- [ ] **Step 5: Version the approved plan in the clean target**

Create
`docs/superpowers/plans/2026-07-14-aria-senior-developer-organization.md`
as a byte-identical copy of this plan, then add a short pointer from the fresh
`_relay/HANDOFF.md`. Do not replace `_relay/PLAN.md`.

Verification:

```bash
cmp \
  /Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief\ of\ Staff/Apps\ Source/MSourcing/_relay/2026-07-14-aria-senior-developer-organization-plan.md \
  docs/superpowers/plans/2026-07-14-aria-senior-developer-organization.md
git diff --check
```

Expected: `cmp` and `git diff --check` exit 0.

### Task 0.2: Capture the clean baseline

**Owner:** `Sonnet-QA-Manifest`  
**Duration:** 60 minutes  
**Dependencies:** Task 0.1  
**Deliverable:** `_relay/evidence/aria-structure-baseline.md` containing the
exact SHA, versions, command outcomes, derived test inventory, migration tip,
and known failures.

- [ ] **Step 1: Capture immutable identifiers**

```bash
git rev-parse HEAD
git status --short --branch
node --version
npm --version
find supabase/migrations -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' | sort | tail -n 1
```

Expected: clean branch status, Node major 22, and one migration-tip path.

- [ ] **Step 2: Install from the lockfile and run source gates**

```bash
npm ci
npm run typecheck
npm run lint
git diff --check
```

Expected: all exit 0. Any inherited source or lint failure blocks this plan and
must remain owned by the preceding product shift.

- [ ] **Step 3: Record the current test and documentation baseline**

```bash
node scripts/run-tests-sandbox.mjs
npx tsx tests/docs-truth.mts
npx tsx tests/repository-hygiene.mts
```

Expected: record exact results without relabeling red output as pass. Failures
outside duplicate inventory, current migration documentation, and current
active-work additions trigger a re-plan.

- [ ] **Step 4: Commit the plan and baseline only**

```bash
git add docs/superpowers/plans/2026-07-14-aria-senior-developer-organization.md _relay/HANDOFF.md _relay/evidence/aria-structure-baseline.md
git diff --cached --check
git commit -m "docs: establish repository organization execution baseline"
```

Expected: one documentation-only commit.

---

## Phase 1: Make repository navigation executable

### Task 1.1: Extract the import-graph helper and pin module boundaries

**Owner:** `Sonnet-QA-Structure`  
**Duration:** 75 minutes  
**Dependencies:** Task 0.2  
**Deliverable:** Reusable import-graph helper and a green boundary suite with
poison fixtures proving every rule fails when violated.

**Files:**

- Create: `tests/helpers/import-graph.mts`
- Create: `tests/module-boundaries.mts`
- Modify: `tests/store-contracts.mts`
- Modify: `package.json`

**Interfaces:**

```ts
export interface ImportGraph {
  files: readonly string[];
  edges: ReadonlyMap<string, readonly string[]>;
  clientEntries: ReadonlySet<string>;
  serverOnlyModules: ReadonlySet<string>;
}

export function buildImportGraph(rootDir: string): ImportGraph;
export function findCycles(graph: ImportGraph): readonly (readonly string[])[];
export function findLayerViolations(graph: ImportGraph): readonly string[];
export function findClientServerViolations(graph: ImportGraph): readonly string[];
```

- [ ] **Step 1: Move the existing TypeScript AST graph logic unchanged**

Move the graph builder and cycle detector from `tests/store-contracts.mts`
into `tests/helpers/import-graph.mts`. Preserve static imports, re-exports,
dynamic imports, relative resolution, alias resolution, and self-cycle
detection. `tests/store-contracts.mts` must import the helper and retain its
public store assertions.

- [ ] **Step 2: Add poison fixtures before real-tree assertions**

`tests/module-boundaries.mts` must construct temporary fixtures for these exact
violations:

1. `src/lib` imports `src/components`.
2. `src/lib` imports `src/app`.
3. `src/components` imports `src/app`.
4. A client entry reaches `src/lib/server` directly.
5. A client entry reaches a `server-only` module through one intermediate.
6. Static two-node cycle.
7. Re-export cycle.
8. Dynamic-import cycle.
9. Self cycle.

Each poison fixture must produce one non-empty violation result. The real
repository must produce zero results.

- [ ] **Step 3: Run the focused gates**

```bash
npx tsx tests/module-boundaries.mts
npx tsx tests/store-contracts.mts
npm run typecheck
git diff --check
```

Expected: poison fixtures are detected, real source has zero cycles and zero
layer violations, and store contracts remain green.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/import-graph.mts tests/module-boundaries.mts tests/store-contracts.mts package.json
git diff --cached --check
git commit -m "test: enforce repository module boundaries"
```

### Task 1.2: Add senior-developer navigation and role ownership maps

**Owner:** `Sonnet-Docs`  
**Duration:** 60 minutes  
**Dependencies:** Task 1.1  
**Deliverable:** Five linked maps that answer where code belongs, what owns
authority, which commands prove it, and who reviews each area.

**Files:**

- Create: `src/lib/README.md`
- Create: `tests/README.md`
- Create: `scripts/README.md`
- Create: `infra/README.md`
- Create: `docs/OWNERSHIP.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `tests/docs-truth.mts`

- [ ] **Step 1: Write the maps from current source truth**

Required content:

- `src/lib/README.md`: dependency direction, `store.ts` and `types.ts` facade
  rules, feature-directory ownership, server-only rules, and new-file routing.
- `tests/README.md`: canonical, security, database, on-demand, browser, and live
  provider groups; required secrets; serial execution; fail-closed behavior.
- `scripts/README.md`: build, database, recovery, release, admin, smoke, visual,
  and worker scripts; root path contracts that must remain.
- `infra/README.md`: `infra/agent-frameworks`, root Fly files, `docker/`,
  `workers/`, `supabase/`, and private framework runtimes.
- `docs/OWNERSHIP.md`: application, infrastructure, database, security,
  privacy, release, incident, and documentation review roles. State that
  CODEOWNERS requires verified GitHub handles before creation.

- [ ] **Step 2: Link every map from one senior onboarding route**

Update `docs/README.md` and `docs/ARCHITECTURE.md` so the reading order is:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `src/lib/README.md`
4. `tests/README.md`
5. `scripts/README.md`
6. `infra/README.md`
7. `docs/TESTING.md`
8. `CONTRIBUTING.md`
9. `SECURITY.md`
10. `production-readiness/README.md`

- [ ] **Step 3: Pin the navigation contract**

Extend `tests/docs-truth.mts` to assert all five files exist and are linked by
`docs/README.md`. Reuse its existing relative-link checks rather than adding a
second link parser.

- [ ] **Step 4: Verify and commit**

```bash
npx tsx tests/docs-truth.mts
npx tsx tests/module-boundaries.mts
git diff --check
git add README.md docs/README.md docs/ARCHITECTURE.md docs/OWNERSHIP.md src/lib/README.md tests/README.md scripts/README.md infra/README.md tests/docs-truth.mts
git diff --cached --check
git commit -m "docs: add senior developer repository maps"
```

Expected: documentation truth and module boundaries exit 0.

### Task 1.3: Move approved root artifacts without deleting them

**Owner:** `Sonnet-Integrator`  
**Duration:** 60 minutes  
**Dependencies:** Task 1.2  
**Deliverable:** Clean root, preserved source assets, documented legacy floor
script, and executable provenance assertions.

**Files:**

- Move the three approved paths from the planned file map.
- Create: `docs/assets/brand-source/README.md`
- Create: `scripts/visual/README.md`
- Modify: `tests/repository-hygiene.mts`
- Modify: `.dockerignore` only if the moved assets change build context.

- [ ] **Step 1: Write failing hygiene assertions**

Add assertions for:

- root `Aria/` is absent;
- both destination assets exist;
- the SHA-256 of `mantu-agents-reference-source.png` equals the SHA-256 of
  `public/brand/mantu-agents-reference.png`;
- root `floor-verify.mjs` is absent;
- `scripts/visual/legacy-floor-verify.mjs` exists;
- `scripts/visual/README.md` identifies `scripts/floor-screenshots.mts` as the
  current script and the moved file as retained legacy evidence.

Run:

```bash
npx tsx tests/repository-hygiene.mts
```

Expected before the move: failure on the new assertions.

- [ ] **Step 2: Move the approved files**

```bash
mkdir -p docs/assets/brand-source scripts/visual
git mv Aria/Aria.png docs/assets/brand-source/mantu-agents-reference-source.png
git mv Aria/Logo.png docs/assets/brand-source/aria-logo-source.png
git mv floor-verify.mjs scripts/visual/legacy-floor-verify.mjs
```

Write the two README files. Do not change the legacy script's behavior in this
commit.

- [ ] **Step 3: Verify references, hashes, and build context**

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' 'Aria/(Aria|Logo)\.png|floor-verify\.mjs' .
shasum -a 256 docs/assets/brand-source/mantu-agents-reference-source.png public/brand/mantu-agents-reference.png
npx tsx tests/repository-hygiene.mts
git diff --check
```

Expected: only intentional documentation/history references, identical first
two hashes, green hygiene tests, and no diff errors.

- [ ] **Step 4: Commit**

```bash
git add docs/assets/brand-source scripts/visual tests/repository-hygiene.mts .dockerignore
git diff --cached --check
git commit -m "chore: organize legacy visual assets"
```

---

## Phase 2: Replace test command strings with one manifest

### Task 2.1: Capture recursive command parity and remove duplicates

**Owner:** `Sonnet-QA-Manifest`  
**Duration:** 45 minutes  
**Dependencies:** Task 1.3  
**Deliverable:** `_relay/evidence/test-command-inventory.json` with ordered,
recursively expanded command records and no silent omissions.

- [ ] **Step 1: Recursively expand package scripts**

The inventory utility must parse `pretest`, `test`, `test:security`, every
`test:db-*` script, `test:owner-recovery`, `test:obscura`, and nested
`npm run` references. Each record must contain:

```ts
interface TestCommandRecord {
  id: string;
  groups: string[];
  program: "node" | "bash" | "npm";
  args: string[];
  files: string[];
  sourceScript: string;
  order: number;
}
```

Convert `tsx file.mts` to `node --import tsx file.mts`. Preserve
`--experimental-test-module-mocks`, `--test`, and argument order. Reject shell
metacharacters and unknown executors.

- [ ] **Step 2: Prove and remove duplicate canonical executions**

The audit snapshot saw repeated Agent Framework contracts through a nested npm
script and a repeated `tests/mcp-query-auth.mts`. The fresh inventory is
authoritative. Remove only exact duplicate canonical records; preserve the
first occurrence's order and all non-canonical group membership.

- [ ] **Step 3: Verify inventory completeness**

The inventory must classify every executable top-level `tests/*.mts`, every
`tests/*.sh`, every `infra/**/*.test.mjs`, and all explicit on-demand/CI tests.
Any unclassified file fails the task.

### Task 2.2: Add the manifest and fail-closed runner

**Owner:** `Sonnet-FullStack`  
**Duration:** 90 minutes  
**Dependencies:** Task 2.1  
**Deliverable:** One argv-array manifest and one serial executor used by all
canonical test entrypoints.

**Files:**

- Create: `tests/test-manifest.mjs`
- Create: `scripts/run-test-manifest.mjs`
- Modify: `scripts/run-tests-sandbox.mjs`
- Modify: `package.json`

**Manifest interface:**

```js
/**
 * @typedef {Object} TestCommand
 * @property {string} id
 * @property {readonly string[]} groups
 * @property {'node'|'bash'|'npm'} program
 * @property {readonly string[]} args
 * @property {readonly string[]} files
 * @property {number} order
 */
```

The committed module must export a frozen `readonly TestCommand[]` named
`testManifest` containing every verified Task 2.1 record as literal data. It
must also export `groupsFor(name)` and `commandsFor(name)`. The contract test
must fail when the array is empty. Do not load manifest data from the
environment, JSON text, a shell command, or another mutable source.

**Runner contract:**

The runner module must export
`runManifestGroups(groups: readonly string[]): Promise<RunSummary>`. Define
`RunSummary` with numeric `selected`, `passed`, `failed`, and `durationMs`
fields through JSDoc because the committed runner is `.mjs`.

Required behavior:

- execute serially in manifest order;
- use `spawnSync(program, args, { stdio: "inherit", shell: false })`;
- fail on unknown group, unknown executor, missing file, signal, or non-zero
  exit;
- stop at the first failure for canonical npm compatibility;
- `--keep-going` is allowed only for diagnosis and must still exit non-zero;
- `--list GROUP` prints IDs and argv without executing;
- never print environment values;
- `scripts/run-tests-sandbox.mjs` becomes a compatibility wrapper and cannot
  skip unknown shapes.

Package compatibility commands:

```json
{
  "pretest": "node scripts/run-test-manifest.mjs pretest",
  "test": "node scripts/run-test-manifest.mjs test",
  "test:all": "node scripts/run-test-manifest.mjs canonical",
  "test:manifest": "node --import tsx tests/test-manifest-contract.mts"
}
```

Keep existing named security, database, owner-recovery, Obscura, framework,
and release commands, but make them select manifest groups or exact manifest
IDs instead of duplicating command strings.

### Task 2.3: Pin manifest completeness and behavior

**Owner:** `Sonnet-QA-Manifest`  
**Duration:** 75 minutes  
**Dependencies:** Task 2.2  
**Deliverable:** Green manifest contract and byte-for-byte ordered parity with
the deduplicated Task 2.1 inventory.

**Files:**

- Create: `tests/test-manifest-contract.mts`
- Modify: `tests/docs-truth.mts`
- Modify: `docs/TESTING.md`
- Modify: `tests/README.md`

Required contract cases:

1. stable unique IDs;
2. one canonical execution per file;
3. every declared file exists;
4. every executable test is classified or explicitly on-demand;
5. argv arrays contain no shell metacharacters;
6. executor allowlist is exact;
7. recursive old inventory and manifest order match after deduplication;
8. unknown groups and executors fail;
9. child non-zero and child signal fail;
10. canonical, security, and database group membership is deterministic;
11. package compatibility commands contain no direct test-file paths;
12. documentation counts are derived from the manifest.

Verification:

```bash
node scripts/run-test-manifest.mjs --list canonical
node scripts/run-test-manifest.mjs --list security
npm run test:manifest
npm test
npm run test:security
npx tsx tests/docs-truth.mts
git diff --check
```

Expected: all commands exit 0, zero duplicates, zero unclassified executable
tests, and no hand-written aggregate count requirement.

Commit:

```bash
git add package.json tests/test-manifest.mjs tests/test-manifest-contract.mts scripts/run-test-manifest.mjs scripts/run-tests-sandbox.mjs tests/docs-truth.mts docs/TESTING.md tests/README.md
git diff --cached --check
git commit -m "test: centralize canonical test execution"
```

---

## Phase 3: Strictly typecheck the test estate

### Task 3.1: Add the strict test config and record the red baseline

**Owner:** `Sonnet-QA-Types`  
**Duration:** 30 minutes  
**Dependencies:** Task 2.3  
**Deliverable:** `tsconfig.tests.json`, `typecheck:tests`, and a diagnostic
ledger grouped by code and file family.

Create this exact config:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "incremental": false,
    "noEmit": true
  },
  "include": ["tests/**/*.mts", "scripts/**/*.mts"]
}
```

Add this package command:

```json
"typecheck:tests": "tsc -p tsconfig.tests.json --pretty false"
```

Run:

```bash
npm run typecheck
npm run typecheck:tests 2>&1 | tee /tmp/aria-test-typecheck-baseline.txt
```

Expected: source typecheck exits 0. Test typecheck may initially fail. Record
the exact diagnostic count and file list in
`_relay/evidence/test-typecheck-baseline.md`. Do not wire a red gate into CI.

### Task 3.2: Fix Agent Framework and authority fixtures

**Owner:** `Sonnet-QA-Types`  
**Duration:** 90 minutes  
**Dependencies:** Task 3.1  
**Deliverable:** Zero diagnostics in Agent Framework, AgentSpec, heartbeat,
runtime-authority, candidate-erasure, and operational-authority test families.

Rules:

- narrow literal unions at fixture construction;
- use typed builders for repeated authority records;
- preserve negative fixtures with explicit invalid-data helpers;
- do not add blanket ignores, disable strict mode, or cast whole fixtures
  through `unknown` to hide errors.

Verification:

```bash
npm run typecheck:tests 2>&1 | rg 'agent-framework|agent-spec|candidate-erasure|operational-authority' && exit 1 || true
npm run test:agent-framework
npx tsx tests/candidate-erasure-contract.mts
node --experimental-test-module-mocks --import tsx --test tests/candidate-erasure-route.mts
```

Expected: no matching diagnostics and all focused runtime tests pass.

Commit only the owned test files and typed helpers.

### Task 3.3: Fix process, environment, request, and fetch fixtures

**Owner:** `Sonnet-QA-Types`  
**Duration:** 90 minutes  
**Dependencies:** Task 3.2  
**Deliverable:** Zero environment mutation, process, Request, Response, fetch,
dispatch, MCP, and email-ambiguity diagnostics.

Use reversible scoped environment helpers instead of mutating read-only
declarations. Use complete `Request`/`Response` fixtures or narrow typed
adapters. Preserve every runtime failure case.

Verification:

```bash
npm run typecheck:tests 2>&1 | rg 'TS(2540|2704|2769)' && exit 1 || true
npx tsx tests/dispatch-outbound.mts
npx tsx tests/mcp-runtime-policy.mts
npx tsx tests/api-validation.mts
node --experimental-test-module-mocks --import tsx tests/email-send-ambiguity.mts
```

Expected: no listed diagnostic codes and all focused tests pass.

### Task 3.4: Close remaining strict diagnostics

**Owner:** `Sonnet-QA-Types`  
**Duration:** 90 minutes  
**Dependencies:** Task 3.3  
**Deliverable:** `npm run typecheck:tests` exits 0 without weakening compiler
options or excluding test families.

Verification:

```bash
npm run typecheck
npm run typecheck:tests
npm test
git diff --check
```

Expected: all exit 0.

If more than 25 diagnostics remain after Tasks 3.2 and 3.3, stop and split the
remaining files into new 60 to 90 minute tasks before continuing.

### Task 3.5: Add test typechecking to CI

**Owner:** `Sonnet-Integrator`  
**Duration:** 30 minutes  
**Dependencies:** Task 3.4  
**Deliverable:** Quality CI runs product typecheck, then test typecheck, exactly
once each.

Add `npm run typecheck:tests` immediately after `npm run typecheck` in the
Quality job. Add a contract assertion that the command occurs exactly once and
before lint/tests.

Verification:

```bash
rg -n 'npm run typecheck|npm run typecheck:tests|npm run lint|npm test' .github/workflows/ci.yml
npm run typecheck
npm run typecheck:tests
npm run lint
git diff --check
```

Commit:

```bash
git add tsconfig.tests.json package.json tests scripts .github/workflows/ci.yml _relay/evidence/test-typecheck-baseline.md
git diff --cached --check
git commit -m "test: typecheck TypeScript test sources"
```

---

## Phase 4: Repair current documentation truth

### Task 4.1: Derive documentation from executable truth

**Owner:** `Sonnet-Docs`  
**Duration:** 60 minutes  
**Dependencies:** Task 3.5  
**Deliverable:** Zero docs-truth failures, with counts and migration tip derived
from the manifest and filesystem.

**Files:**

- Modify: `tests/docs-truth.mts`
- Modify: `README.md`
- Modify: `production-readiness/STATUS.md`
- Modify: `production-readiness/DEPLOYMENT_RUNBOOK.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`

Required corrections:

- use manifest-derived canonical, pretest, application, security, database,
  and on-demand counts;
- derive the current migration filename from `supabase/migrations/`;
- include `infra/`, `workers/`, and `supabase/rollbacks/` in current maps;
- retain Fly as canonical production and distinguish Vercel demo material;
- keep source verification separate from live production evidence.

Verification:

```bash
find supabase/migrations -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' | sort | tail -n 1
npx tsx tests/docs-truth.mts
npx tsx tests/repository-hygiene.mts
npm run test:manifest
git diff --check
```

Expected: every command exits 0 and docs contain no frozen aggregate count that
can drift independently from the manifest.

Commit:

```bash
git add README.md docs production-readiness tests/docs-truth.mts
git diff --cached --check
git commit -m "docs: derive repository truth from executable sources"
```

---

## Phase 5: Prove one safe code-decomposition pattern

### Task 5.1: Characterize booking and reporting actions

**Owner:** `Sonnet-QA-Application`  
**Duration:** 75 minutes  
**Dependencies:** Task 4.1  
**Deliverable:** Failing factory tests that fully capture the current booking
and reporting behavior before extraction.

**Files:**

- Create: `tests/store-booking-report-actions.mts`
- Test against: `src/lib/store.ts`, `src/lib/store/contracts.ts`

Required cases:

1. Factory module is React-free and has no client directive.
2. Workspace unavailable rejects before calendar I/O.
3. Missing candidate or campaign rejects.
4. Suppressed, opted-out, or unsubscribed candidate rejects.
5. Busy interviewer rejects reschedule without commit.
6. Live calendar non-2xx rejects without local booking or stage change.
7. Live calendar success persists the provider link.
8. Demo/no-live-seat booking preserves current synthetic behavior.
9. Successful booking updates stage, metrics, activity, win record, and event.
10. Completing a booking advances only a candidate still at `Booked`.
11. Report generation replaces the campaign report without erasing reviewed
    skill decisions.
12. Skill decision updates both campaign and report projections.
13. Commit rejection cannot return a false success.
14. Public `HermesActions` signatures do not change.

Run before implementation:

```bash
npx tsx tests/store-booking-report-actions.mts
```

Expected: failure because `src/lib/store/booking-report-actions.ts` and its
factory do not exist.

### Task 5.2: Extract the React-free booking/report factory

**Owner:** `Sonnet-FullStack`  
**Duration:** 90 minutes  
**Dependencies:** Task 5.1  
**Deliverable:** Existing four actions composed from a React-free factory while
`src/lib/store.ts` remains the public entrypoint.

**Files:**

- Create: `src/lib/store/booking-report-actions.ts`
- Modify: `src/lib/store.ts`
- Modify: `tests/store-contracts.mts`

**Interfaces:**

```ts
export type BookingReportActions = Pick<
  HermesActions,
  | "createBookingFor"
  | "updateBooking"
  | "generateReport"
  | "setSkillUpdateStatus"
>;

export interface BookingReportActionDependencies {
  currentState: () => HermesState | null;
  commit: (update: (state: HermesState) => HermesState) => boolean;
  workspaceEffectAllowed: () => boolean;
  workspaceFetch: typeof fetch;
  liveCalendarEnabled: () => boolean;
  resolveBookingSlot: typeof resolveBookingSlot;
  createBooking: typeof createBooking;
  interviewerPrepEmail: typeof interviewerPrepEmail;
  candidateConfirmationEmail: typeof candidateConfirmationEmail;
  interviewerIsBusy: typeof interviewerIsBusy;
  appendWinRecord: typeof appendWinRecord;
  recomputeMetrics: (state: HermesState, campaignId: string) => HermesState;
  makeActivity: (draft: ActivityDraft) => Activity;
  withActivity: (
    state: HermesState,
    activity: Activity,
    campaignId: string | null,
  ) => HermesState;
  generateWeeklyReport: typeof generateWeeklyReport;
  emit: (event: HermesEvent) => void;
}

export function createBookingReportActions(
  dependencies: BookingReportActionDependencies,
): BookingReportActions;
```

Move the existing callback bodies from the booking/report section of
`HermesProvider` into this factory. Replace closure reads only with the named
dependencies. Do not change response shapes, messages, activity text, order of
remote and local effects, stage transitions, or report merge behavior.

In `src/lib/store.ts`, create one memoized `bookingReportActions` object from
stable dependencies and spread it into the existing `actions` object. Preserve
the `@/lib/store` import path and `HermesActions` compatibility export.

Verification:

```bash
npx tsx tests/store-booking-report-actions.mts
npx tsx tests/store-contracts.mts
npx tsx tests/workspace-effectful-actions.mts
npx tsx tests/scoring-metrics.mts
npx tsx tests/module-boundaries.mts
npm run typecheck
npm run typecheck:tests
npm run lint
git diff --check
```

Expected: all exit 0.

### Task 5.3: Independent code and security review

**Owner:** `Sonnet-Security`  
**Duration:** 45 minutes  
**Dependencies:** Task 5.2  
**Deliverable:** Written GO or concrete findings in `_relay/codex-findings.md`.

Review exact diff for:

- remote calendar I/O still occurs before local success;
- workspace unavailable still blocks before I/O;
- suppression gates remain exact;
- no browser state gains server authority;
- commit failure cannot report success;
- no new import cycle or client/server path;
- no log or error exposes provider bodies or candidate data.

If a concrete issue is found, mark it open and return ownership to
`Sonnet-FullStack`. After repair, rerun Task 5.2 verification and mark the
finding fixed with the commit SHA.

Commit after GO:

```bash
git add src/lib/store.ts src/lib/store/booking-report-actions.ts tests/store-booking-report-actions.mts tests/store-contracts.mts _relay/codex-findings.md
git diff --cached --check
git commit -m "refactor: extract booking and report store actions"
```

---

## Phase 6: Four-lane QA and release-candidate proof

Tasks 6.1 through 6.4 may run in parallel on the exact same commit. They are
read-only and must record the SHA they reviewed.

### Task 6.1: Test-system QA

**Owner:** `Sonnet-QA-Manifest`  
**Duration:** 60 minutes  
**Dependencies:** Task 5.3  
**Deliverable:** Manifest, typecheck, and suite-parity report.

```bash
npm run test:manifest
npm run typecheck
npm run typecheck:tests
npm test
npm run test:security
```

Expected: all exit 0, zero duplicate canonical IDs, zero unclassified
executables, and zero TypeScript diagnostics.

### Task 6.2: Structure and documentation QA

**Owner:** `Sonnet-QA-Structure`  
**Duration:** 60 minutes  
**Dependencies:** Task 5.3  
**Deliverable:** Navigation, links, paths, root hygiene, and import report.

```bash
npx tsx tests/module-boundaries.mts
npx tsx tests/store-contracts.mts
npx tsx tests/docs-truth.mts
npx tsx tests/repository-hygiene.mts
git diff --check
```

Expected: all exit 0.

### Task 6.3: Application and browser QA

**Owner:** `Sonnet-QA-Application`  
**Duration:** 75 minutes  
**Dependencies:** Task 5.3  
**Deliverable:** Synthetic demo smoke report covering navigation and the
booking/report surface at desktop and mobile widths.

Run the app with synthetic demo login only, then verify:

1. login;
2. protected shell;
3. campaign detail navigation;
4. candidate drawer open/close;
5. booking creation and reschedule validation;
6. report generation and skill decision persistence;
7. error state after a rejected calendar request;
8. keyboard navigation;
9. 1440x900 and 390x844 viewports;
10. zero console errors.

Store screenshots under `/tmp/aria-structure-qa`, not in Git.

### Task 6.4: Security and release-contract QA

**Owner:** `Sonnet-Security`  
**Duration:** 60 minutes  
**Dependencies:** Task 5.3  
**Deliverable:** Security, database classification, and release-contract report.

```bash
npm audit --audit-level=high
gitleaks git . --redact=100 --no-banner --config .gitleaks.toml --log-opts='--all'
npm run test:db-privileges
npm run test:owner-recovery
npm run test:fly-db-volume
```

Expected: all exit 0. A network or runtime infrastructure failure is blocked
evidence, not a pass.

### Task 6.5: Final local candidate gate

**Owner:** `Sonnet-Final-Validator`  
**Duration:** 90 minutes  
**Dependencies:** Tasks 6.1, 6.2, 6.3, 6.4  
**Deliverable:** Exact-SHA local release receipt with no skipped mandatory gate.

```bash
npm ci
npm run typecheck
npm run typecheck:tests
npm run lint
npm test
npm run test:security
npm run test:owner-recovery
npm run build:isolated
git diff --check
git status --short --branch
git rev-parse HEAD
```

Expected: all commands exit 0, no diff-check output, clean status after the
verification evidence and Baton update are committed.

### Task 6.6: Archive and rewrite the Relay baton

**Owner:** `Sonnet-Integrator`  
**Duration:** 45 minutes  
**Dependencies:** Task 6.5  
**Deliverable:** Archived prior baton plus a fresh current snapshot that Claude
or Codex can execute without this conversation.

Archive `_relay/HANDOFF.md` as
`_relay/archive/<timestamp>-claude-sonnet-4-6.md`, then rewrite
`_relay/HANDOFF.md` with:

- exact base and final SHAs;
- current branch and worktree;
- changed files by task;
- every verification command and exit result;
- open findings and exact errors;
- next commands for integration into `main`;
- decisions that must not be reopened;
- no secret values, candidate data, or local tokens.

Commit:

```bash
git add _relay docs/superpowers/plans/2026-07-14-aria-senior-developer-organization.md
git diff --cached --check
git commit -m "docs: hand off repository organization candidate"
```

### Task 6.7: Push and prove exact-SHA GitHub checks

**Owner:** `Sonnet-Integrator`  
**Duration:** 90 minutes, plus a separate bounded watch task if supply-chain
checks remain in progress  
**Dependencies:** Task 6.6  
**Deliverable:** Remote SHA equals local SHA and every required CI/CodeQL check
is successful for that SHA.

```bash
REPO=mysticalsin/aria-sourcing-demo
BRANCH=$(git branch --show-current)
SHA=$(git rev-parse HEAD)

git push origin "$BRANCH"
REMOTE_SHA=$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)
test "$REMOTE_SHA" = "$SHA"

gh run list --repo "$REPO" --commit "$SHA" --limit 20 \
  --json databaseId,workflowName,event,headSha,status,conclusion,url
```

For each CI and CodeQL run:

```bash
gh run watch RUN_ID --repo "$REPO" --exit-status
gh run view RUN_ID --repo "$REPO" --json headSha,event,status,conclusion,url,jobs
```

On failure:

```bash
gh run view RUN_ID --repo "$REPO" --log-failed
```

Required successful checks:

- Quality
- Secret scan
- Dependency audit
- Database security
- Production image supply chain
- Release gate
- CodeQL JavaScript/TypeScript analysis

Do not merge or fast-forward `main` until the exact candidate SHA is green and
an independent reviewer returns GO. Do not deploy production as part of this
repository-organization plan.

---

## Follow-on decomposition plans

This plan proves one extraction pattern. After it is green and integrated,
write three separate implementation plans, each with its own tests and review:

1. `src/app/campaigns/[id]/page.tsx`: keep the route path, extract pure model,
   controller, overview, sourcing, outreach, interviews, and reporting panels.
2. `src/components/careers/chatbox.tsx`: keep the public component path,
   extract types, constants, state machine, scoring, message thread, composer,
   and submission adapter.
3. `src/app/api/sourcing-agent/route.ts`: keep the route path, extract request
   validation, principal/campaign authority, prompt construction, provider
   execution, response validation, and learning receipts into server-only
   modules.

Do not combine these three subsystems into one structural pull request.

## Parallel opportunities

- Tasks 1.1 and the initial content draft for Task 1.2 may run in parallel,
  but only Task 1.1's owner edits tests during that window.
- Task 2.1 inventory can be reviewed by `Sonnet-Security` while
  `Sonnet-FullStack` prepares the runner interface.
- Tasks 3.2 and 3.3 may run in parallel only with disjoint test-file ownership;
  Task 3.4 integrates the result.
- Tasks 6.1 through 6.4 run in parallel on one immutable SHA.

## Critical path

Task 0.1 -> Task 0.2 -> Task 1.1 -> Task 1.2 -> Task 1.3 -> Task 2.1 ->
Task 2.2 -> Task 2.3 -> Task 3.1 -> Task 3.2 -> Task 3.3 -> Task 3.4 ->
Task 3.5 -> Task 4.1 -> Task 5.1 -> Task 5.2 -> Task 5.3 -> Task 6.5 ->
Task 6.6 -> Task 6.7.

Primary bottleneck: strict test typechecking. The planning snapshot found 149
diagnostics, so Tasks 3.2 through 3.4 must remain bounded and evidence-led.

## Commit sequence

1. `docs: establish repository organization execution baseline`
2. `test: enforce repository module boundaries`
3. `docs: add senior developer repository maps`
4. `chore: organize legacy visual assets`
5. `test: centralize canonical test execution`
6. `test: typecheck TypeScript test sources`
7. `docs: derive repository truth from executable sources`
8. `refactor: extract booking and report store actions`
9. `docs: hand off repository organization candidate`

Each commit must pass its focused gate. Commits 5 through 9 must also pass
module boundaries and product typecheck.

## Re-plan triggers

Stop and rewrite the affected phase if any condition occurs:

1. Shift 40 changes the planned facade, test runner, booking/report callbacks,
   or moves any planned path.
2. The clean baseline has inherited source errors, more than 25 unexpected
   documentation/manifest failures, or a different deployment branch topology.
3. More than 25 strict test diagnostics remain after Tasks 3.2 and 3.3.
4. Manifest parity requires changing test semantics, process isolation, order,
   or mocking flags.
5. Booking/report extraction changes a server effect, response shape, public
   action signature, serialized state, or current negative-test behavior.
6. Any move has an unrecorded consumer or breaks a release/path contract.
7. Credentials, production data, or irreversible Git operations become
   necessary.

## Spec coverage self-review

| Approved design requirement | Implemented by |
|---|---|
| Clean target and concurrent-work protection | Tasks 0.1 and 0.2 |
| Senior developer navigation | Tasks 1.1 and 1.2 |
| Approved root artifact moves without deletion | Task 1.3 |
| Declarative, unique test source of truth | Tasks 2.1 through 2.3 |
| Strict `.mts` typechecking | Tasks 3.1 through 3.5 |
| Current documentation truth | Task 4.1 |
| Stable facades and one-domain extraction | Tasks 5.1 through 5.3 |
| Four independent QA lanes | Tasks 6.1 through 6.4 |
| Full local and exact-SHA remote proof | Tasks 6.5 through 6.7 |
| Relay continuity for Claude and Codex | Tasks 0.1, 0.2, and 6.6 |
| Larger UI/API decomposition | Follow-on decomposition plans |

Coverage gaps: none for the approved release-sized organization pass. Human
GitHub ownership handles and production deployment are intentionally excluded
because they require separate authority.

## Plan self-review

- Every task has one named owner.
- Every task is 90 minutes or less; a long CI watch becomes a separate task.
- Every task has a checkable file or evidence deliverable.
- Dependencies and parallel windows are explicit.
- No production mutation or destructive Git operation is authorized.
- No unresolved implementation marker remains.
- Interface names are consistent across tasks.
- The plan starts with a clean-baseline stop gate and ends with exact-SHA proof.

## Executor walk-through

Before execution, `Sonnet-Integrator`, `Sonnet-FullStack`,
`Sonnet-QA-Manifest`, `Sonnet-QA-Types`, and `Sonnet-Security` must each read
this plan and confirm their owned tasks in the new Relay baton. This is a
coordination acknowledgement, not permission to bypass Task 0.1.

## Execution ledger

The executor appends only verified facts here after shift 40 closes:

| Field | Value |
|---|---|
| Clean local main base SHA | Not recorded because shift 40 is active |
| Structure branch | `codex/aria-structure-hygiene-20260714` |
| Structure worktree | `/Users/tony/.codex/worktrees/msourcing-structure-hygiene` |
| Final candidate SHA | Not recorded before execution |
| Pull request | Not created before execution |
| Exact-SHA CI | Not run before execution |
