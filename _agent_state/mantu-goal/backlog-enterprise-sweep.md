# Enterprise-Ready Full Sweep — Ranked Backlog

Goal: `goal-2026-07-02-enterprise-ready-full-sweep`, milestone m1.
Generated: 2026-07-02.

> ⛔ **REFUSED CLUSTER — DO NOT "FIX".** The audit's ai-surfaces P0 (`obscura-launcher.ts`
> `--stealth --allow-private-network`) and its praised "interactive browsing lever"
> (`web-tools.ts` `browser_act` + friends, `tests/web-tools.mts` guard widened 3→8) are the
> **recurring stealth-browser capability that is refused** (see goal `refused_capabilities` +
> memory `feedback-stealth-obscura-refusal`). No crew may extend, complete, or ship this cluster.
> Stealth flags were stripped as harm-reduction; the compliant surface is the committed 3 read-only
> web tools (`web_search`/`fetch_page`/`rss`) + `browser-tools.ts` safe vocabulary only. Verification
> and deploy run from a clean-HEAD state where this cluster is absent.

---

## 1. Baseline Gate Results

| Gate | Result | Key numbers |
|---|---|---|
| `next build` (production, Turbopack) | ✅ PASS | Compiled in 26.6s, TS checked in 10.5s, 39/39 static pages generated, all API routes + middleware built. (First attempt failed under sandbox — Turbopack middleware compile needs to spawn a child process/bind a port; re-ran with sandbox disabled and it passed cleanly. Sandbox artifact, not a code bug.) |
| `tsc --noEmit` | ✅ PASS | 0 errors, empty stdout/stderr, exit code 0. |
| ESLint | ❌ FAIL | 1 error, 1 warning. Error: `src/components/candidates/candidate-drawer.tsx:140:39` — `useState` called conditionally (`react-hooks/rules-of-hooks`). Warning: unused eslint-disable directive in `src/lib/ai/obscura-launcher.ts:11`. |
| Full test suite (37 tsx test files) | ✅ PASS | 37/37 files, 0 failures across all (fleet, scoring, security-redos, hermes-live, audit-fixes, obscura-adapter, web-tools, etc.). Sandbox-disabled run (sandboxed run hit an unrelated tsx IPC EPERM in `$TMPDIR`). |
| Runtime smoke (18 routes, real dev server + headless Chrome, demo auth) | ✅ PASS | All 18 routes (`/`, `/intake`, `/candidates`, `/campaigns`, `/outreach`, `/replies`, `/calendar`, `/reports`, `/chat`, `/curator`, `/sessions`, `/fleet`, `/floor`, `/memory`, `/soul`, `/skills`, `/settings`, `/login`) returned HTTP 200, zero console errors, zero uncaught pageerrors. `/floor` (WebGL) given a 10s settle window, clean. |

**Gate status: 4/5 pass. Blocking gate: ESLint (1 real error — a rules-of-hooks violation, not a lint-style nit).**

---

## 2. Per-Section Grade Summary

| Section | Grade | P0 | P1 | P2 | Total findings | Top 10x lever |
|---|---|---|---|---|---|---|
| agent-3d (Fleet + Floor/3D + Memory + Soul + Skills) | C | 2 | 5 | 3 | 10 | Make the fleet actually scale past ~40 agents — implement the promised instanced-proxy rendering on `/floor` and add search/filter/virtualization to the Fleet roster grid. |
| campaigns | C | 1 | 5 | 8 | 14 | Add a one-click "Source all N idle campaigns" bulk action (list page + Attention panel) driven by the idle/stalled list `deriveRecommendations` already computes. |
| ai-surfaces (Chat + Curator + Sessions) | C | 1 | 6 | 5 | 12 | Wire the sourcing-agent tool loop (`search_candidates`) into the Chat surface's tool loop so recruiters can source directly from conversation instead of only via `/campaigns` → `/api/sourcing-agent`. |
| **Total** | — | **4** | **16** | **16** | **36** | |

All three audited sections graded C — no section is currently above baseline.

---

## 3. Findings — P0 and P1 (grouped by section, P0 first)

### Section: agent-3d (Fleet + Floor/3D + Memory + Soul + Skills)

- [ ] **[P0][security]** `src/app/skills/page.tsx` — Neither `SkillsPage` nor `SkillCard` imports `useRole`/`can()`. Every other page in this cluster gates mutating actions behind RBAC, but Skills has none: a `viewer` role (documented as read-only) can freely Run learning, Accept/Dismiss proposals, and edit+Save raw playbook content that drives future sourcing/outreach/scoring behavior fleet-wide.
  **Fix:** Add `const canEditSkills = can(useRole(), 'skills')` (permission already exists in `rbac.ts`, granted to member+admin, not viewer) in `SkillsPage` and `SkillCard`; disable/hide Run learning, Accept, Dismiss, Save, Reset for viewers — mirror the `isAdmin`/`canManageFleet` pattern in `persona-editor.tsx`/`seat-card.tsx`.

- [ ] **[P0][perf]** `src/app/floor/page.tsx:222` — Floor3DSection claims "Nearest 48 fully animated; N more rendered as live instanced proxies for performance" but passes the full, uncapped `office` array into `<Floor3D>` — zero InstancedMesh/proxy exists anywhere in `src/components/floor3d`. Every seat gets a full rigged character model plus an O(n²) `applyCollisionBumps` loop every frame (`systems/agentTick.ts:44-82`), and `DESK_POSITIONS` only has 40 fixed slots, so agent #41+ stacks on an occupied desk. Fleet's own `defaultFleetSettings()` allows up to 300 agents, so a realistic deploy (even ~80-100) visibly breaks and can freeze the tab.
  **Fix:** Actually slice `office` to `FULL_DETAIL` before rendering (`office.slice(0, FULL_DETAIL)`) and render the remainder as a genuine cheap proxy (InstancedMesh dots/billboards), not full rigs. Separately, scale `DESK_POSITIONS`/roam capacity with seat count or cap "sitting" agents and route overflow to idle/standing.

- [ ] **[P1][security]** `src/components/skills/skill-card.tsx:87` — `SkillCard.save()` shows a "Playbook rejected... guardrail" message on `!res.ok`, but the backing `updateSkillContent` (`src/lib/store.ts:2992-3001`) unconditionally commits and returns `{ ok: true }` — there is no guardrail/validation logic at all, so the rejection path is dead code and playbook content is never checked before it drives agent behavior at runtime.
  **Fix:** Implement real validation inside `updateSkillContent` (reuse whatever content-safety check protects the Aria master prompt/persona, or add a minimal length/banned-pattern check) and return `{ ok:false, error }` on violation so the already-built rejection UI actually fires.

- [ ] **[P1][structure]** `src/app/fleet/page.tsx` (and `/memory`, `/soul`, `/skills`) — Only `/floor` (plus `/campaigns/[id]` and `/settings`) has a route-scoped `error.tsx`; these four pages fall back to the generic root `error.tsx` on a render crash instead of a targeted recovery message. Fleet is highest-risk — it mixes seat mutation, LLM provider/model assignment, and allocation logic in one page.
  **Fix:** Add `error.tsx` siblings for `src/app/fleet`, `src/app/memory`, `src/app/soul`, `src/app/skills` following the exact pattern in `src/app/floor/error.tsx` (scoped copy + `reset()` button + digest display).

- [ ] **[P1][perf]** `src/app/fleet/page.tsx:394` — The roster grid (`seats.map(...)`) has no search, filter, pagination, or virtualization. Each `SeatCard` is heavyweight (LLM provider/model dropdowns, 13-swatch color picker, expandable prompt/config panels). Deploying near the page's own `maxAgents:300` ceiling (which the "Deploy N agents" control actively encourages) makes the page slow to mount/scroll and impossible to scan by name.
  **Fix:** Add a name/provider/status filter above the grid and virtualize or paginate `SeatCard`s once count passes ~24-30, so fleet management stays usable at the scale the product markets.

- [ ] **[P1][ux]** `src/components/soul/persona-editor.tsx:244` — `useEffect(() => setPersona(selectedSeat?.persona ?? ""), [selectedSeatId, ...])` silently overwrites the persona textarea's draft the instant the operator clicks a different agent, with no dirty-state warning. The file already has `useConfirm()` wired up for a lower-stakes action (disabling a guardrail) but doesn't apply it here.
  **Fix:** Before switching `selectedSeatId` while `personaDirty` is true, call the existing `useConfirm()` — "Discard unsaved persona changes?" — or auto-save on switch.

- [ ] **[P1][data]** `src/components/memory/memory-panel.tsx:181` — Hardcodes `capacity = 200` and displays it via a `<Meter>` as an enforced ceiling, but instantiates a throwaway `React.useContext(React.createContext(...))` every render that can only ever return `{}` (dead code). `store.addMemory` (`store.ts:3914-3944`) never checks any capacity, so the meter can read "350/200" forever with no enforcement — real risk of hitting the browser localStorage quota across up to 300 seats and breaking persistence for the whole workspace.
  **Fix:** Delete the dead inline `createContext` call. Enforce the displayed 200-entry cap inside `addMemory` (reject or evict oldest unpinned at capacity), or remove the implied ceiling from the UI, and wrap the localStorage write path in try/catch to surface a quota-exceeded warning instead of failing silently.

### Section: campaigns

- [ ] **[P0][data]** `src/app/campaigns/[id]/page.tsx:321` — Pause/Resume relies on component-local state (`prePauseStatus`) to remember the campaign's status before pausing, set in `handlePause` (446-454) and consumed by `handleResume` (456-465). This state lives only in the mounted instance and is never persisted on the Campaign object. If the user pauses, navigates away, and returns before resuming, `prePauseStatus` resets to null and `handleResume` silently restores the campaign to the hardcoded fallback `"Sourcing"` instead of its true prior status — no confirmation, no warning, no recovery path — and cascades into `campaignHealth()`, `nextActionForCampaign()`, and the `source_campaign` recommendation.
  **Fix:** Persist the pre-pause status on the Campaign record itself (`previousStatus: CampaignStatus | null`, set/read via `updateCampaign`), or better: make "paused" an independent boolean flag that never overwrites `status`, so resuming is zero-information-loss.

- [ ] **[P1][ux]** `src/app/campaigns/page.tsx:52` — `CAMPAIGN_STATUSES` includes `Intake`, `Outreach`, `Interviewing`, `Closing` as filterable options, but no real action ever sets a campaign to `Intake`/`Closing`, and `Outreach`/`Interviewing` only ever appear in seed fixtures — `buildCampaign()` always creates new campaigns as `"Sourcing"`, and every real status transition goes to `Paused`, restored, or `Filled`. Filtering by these values on any real campaign always silently returns zero results.
  **Fix:** Wire real status transitions into the actual actions (auto-advance to `Outreach` on first send, `Interviewing` on first booking), or drop those unreachable values from the filter and drive progress off the existing metrics-based health/next-action signals.

- [ ] **[P1][ux]** `src/app/campaigns/[id]/page.tsx:406` — `handleSource` (wired to "Source next batch") and `handleBook` (485-496, "Book" button) have no in-flight/loading state, unlike `handleRunAgent`'s `agentRunning`. Both can hit real network calls (`/api/source`, `/api/calendar/event`) that take real time; with no disabling/spinner, users are likely to double-click, firing duplicate live-search requests or duplicate bookings.
  **Fix:** Track a local `sourcing`/`bookingId` loading state per action and pass `loading`/`disabled` to `Button` (which already supports a `loading` prop), mirroring the `agentRunning` pattern.

- [ ] **[P1][ux]** `src/app/campaigns/[id]/page.tsx:655` — The "Review outreach" button (`router.push("/outreach")`) drops all campaign context. The outreach page's `campaignFilter` state always initializes to `"all"` and never reads `activeCampaignId` for the actual filtered lists (only for the rate-meter panel). A recruiter deep in campaign X lands on the fully unfiltered outreach queue and must manually re-select the filter.
  **Fix:** Pass the campaign id when navigating (`/outreach?campaign=${c.id}`) and have the outreach page read it, or default `campaignFilter` to `useActiveCampaignId()`.

- [ ] **[P1][perf]** `src/components/ui/tabs.tsx:113` — `TabPanel` hides inactive panels with `hidden={!active}` rather than not rendering them, so on the campaign detail page all 8 tabs (CandidateTable, every OutreachMessageCard, ReplyClassifier + ReplyCards, BookingCalendar, InterviewerPanel, WeeklyReportCard, SkillUpdateCards, charts) mount and render simultaneously on every render regardless of visible tab — directly working against the stated 10-20x throughput goal at scale.
  **Fix:** Only render a panel's children when active (`{active && children}`), or lazy-mount each panel on first open and keep it mounted (`hasBeenActive || active`) to retain in-panel state without paying render cost up front.

- [ ] **[P1][ux]** `src/app/campaigns/[id]/page.tsx:467` — `handleMarkFilled` flips a campaign to the terminal `Filled` status with zero confirmation dialog, and there is no "reopen" control anywhere in the UI — a single misclick permanently and silently changes a core object with no built-in recovery path.
  **Fix:** Add a confirm step (dialog or undo-able toast, matching patterns used elsewhere) before committing the `Filled` change, and/or expose a control to move a campaign back off `Filled`.

### Section: ai-surfaces (Chat + Curator + Sessions)

- [ ] **[P0][security]** `src/lib/ai/obscura-launcher.ts:57` — This new (uncommitted) file spawns the local Obscura sidecar with `["serve", "--port", ..., "--stealth", "--allow-private-network"]`, directly contradicting the explicit safety invariant documented elsewhere in this same cluster: `browser-tools.ts:9-10` states "No stealth... without the `--stealth`/`--allow-private-network` flags" and `docker/obscura/Dockerfile:47` says verbatim "Never add `--stealth` or `--allow-private-network` here." `--stealth` is bot-detection evasion; `--allow-private-network` disables Chromium's Private Network Access protections — a real SSRF pivot via page-executed JS that app-level `assertPublicUrl`/robots.txt checks don't cover (they only re-validate top-level navigation URLs). This is live today: `tests/obscura-integration.mts` now calls `ensureObscuraRunning()`, so any developer running the test suite or `npm run dev` with `OBSCURA_URL` unset is currently spawning a stealth, private-network-capable browser locally.
  **Fix:** Change the spawn args to `["serve", "--port", String(PORT)]` only, matching the Dockerfile's CMD exactly. If stealth/private-network mode is intentionally wanted for another reason, that needs explicit review through the same gate the rest of this cluster already uses — it must never silently ship via a launcher helper.

- [ ] **[P1][code]** `src/app/api/hermes/chat/route.ts:220` — `webResearch` registers two servers with overlapping tool names: `BUILTIN_WEB_URL` (web-tools.ts's `WEB_TOOL_DEFS`, pushed first) and `BUILTIN_BROWSER_URL` (browser-tools.ts's `BROWSER_TOOL_DEFS`, pushed second). Name-collision resolution keeps the first server's definition, so the model is always given `WEB_TOOL_DEFS`'s nested `browser_act` schema (`{sessionId, action:{type,...}}`), but dispatch still runs through `runBrowserTool` → `browserAct`, which reads a flat `args.type`/`args.selector`. Since the model always sends `action` nested, `args.type` is always undefined and every `browser_act` call fails with `Unsupported action ""` for any real (non-Kimi-demo) provider with web research enabled — the agent can open a page but never click/scroll/wait on it.
  **Fix:** Remove the duplicate `browser_open`/`browser_act`/`browser_extract`/`browser_screenshot`/`browser_close` entries from `WEB_TOOL_DEFS` (browser-tools.ts's `BROWSER_TOOL_DEFS` is the correct, flat-schema source of truth), or filter them out before pushing `BUILTIN_WEB_URL`. Add a test that round-trips the schema actually given to the model into `browserAct`'s expected arg shape.

- [ ] **[P1][ux]** `src/components/chat/chat-list.tsx:26` — `handleDelete` calls `actions.deleteChatThread(id)` directly on a single hover-trash-icon click — no confirmation, no undo. `deleteChatThread` is a hard, unconditional filter committed immediately to persisted state (localStorage/Supabase), inconsistent with the app's established `ConfirmDialog` pattern used elsewhere (candidate-drawer, settings, intake, topbar). A misclick permanently destroys an entire conversation history.
  **Fix:** Route chat thread deletion through the existing `ConfirmDialog`, or a toast with an "Undo" affordance that briefly holds the deleted thread before committing.

- [ ] **[P1][ux]** `src/components/chat/chat-thread-view.tsx:46` — The `/clear` slash command is advertised in `chat-composer.tsx`'s `SLASH_HINTS` ("Clear this thread's messages") but doesn't clear anything — the handler's own comment admits there's no `clearThread` action, so it just appends a "Thread cleared." system message while every prior message stays visible above it. Advertised behavior directly contradicts actual behavior.
  **Fix:** Add a real `clearChatThread(threadId)` store action that empties (or archives) `messages` while preserving the thread id, and call it from the `/clear` handler; or remove the command/hint until implemented.

- [ ] **[P1][ux]** `src/lib/store.ts:3904` — `cancelChat(threadId)` is fully implemented (AbortController per thread, wired through the streaming fetch) but is never invoked from any component (zero call sites across `src/components`/`src/app`). `ChatComposer` disables Send entirely while `sending` is true, so there's no way to interrupt a slow, looping, or runaway streaming reply short of leaving the page.
  **Fix:** Swap the Send button for a "Stop" control while sending/streaming, calling `actions.cancelChat(threadId)` — the backend plumbing already exists; this is purely a missing UI wire-up.

- [ ] **[P1][code]** `src/components/curator/file-browser.tsx:38` — Clicking into a subfolder calls `setPath(...)`, sent to the proxy as `params.set("path", path)`, but `src/app/api/hermes/proxy/route.ts` only forwards an explicit allow-list of query params (`["page","limit","cursor","q","level"]`) — `path` is not on that list and is silently dropped before reaching the Aria runtime. Every folder click (and "Up") re-requests the same root listing; directory navigation is completely non-functional in live mode, with no error surfaced.
  **Fix:** Add `"path"` to the forwarded-param allow-list in `src/app/api/hermes/proxy/route.ts` (with the same validation rigor as the other params), and confirm it matches whatever query-param name the live `api/files` endpoint actually expects.

- [ ] **[P1][ux]** `src/components/chat/chat-thread-view.tsx:198` — `MessageBubble` renders all content as raw plain text (`<span className="whitespace-pre-wrap">{msg.content}</span>`) with no Markdown parsing anywhere. The app's own `/persona` command injects `**${seat.name} persona:**`, which renders as literal asterisks, and any live LLM reply using headers/bullets/code fences (default behavior for general-purpose models) shows raw markdown clutter — materially degrading perceived quality of every AI reply in the flagship Chat surface.
  **Fix:** Render assistant/system bubbles through a lightweight Markdown component (e.g. `react-markdown` with a restricted safe-element set, no raw HTML) while keeping user bubbles plain text.

---

## 4. 10-20x Throughput Levers (one per cluster)

1. **campaigns** — The system already computes, in `deriveRecommendations` (`src/lib/recommendations.ts:255-271`), the exact list of campaigns sitting empty or stalled at "Sourced" — but there is zero bulk action anywhere to act on it, and even the individual Attention-panel row deep-links to the generic `/campaigns` list (`KIND_HREF`, `recommendations.ts:71-78`) instead of the specific campaign. Today, unsticking N idle campaigns costs N manual open-and-click round trips. **Add a single "Source all idle campaigns" bulk action** (list page + Attention panel) that fires `sourceNextBatch`/`runSourcingAgent` across every flagged campaign in one pass — turns a linear, click-per-campaign bottleneck into a one-click, N-campaign burst.

2. **ai-surfaces** — **Wire the sourcing-agent tool loop** (`search_candidates`, `src/lib/ai/sourcing-tools.ts`) into the Chat surface's `/api/hermes/chat` tool loop alongside the existing web/browser research tools. Today sourcing only runs through a separate `/api/sourcing-agent` route reached from Campaigns; Chat is a disconnected, generic Q&A persona bot. Letting a recruiter say "find me 15 backend engineers in Berlin with Go + Kubernetes" directly in Chat and get real, deduped, scored candidates accumulated inline (mirroring `makeSourcingToolRunner`'s proven pattern) collapses a multi-page, multi-mode workflow into one continuous conversation.

3. **agent-3d** — **Make the fleet actually scale past ~40 agents.** Both primary agent-management surfaces degrade before the product's own 300-agent ceiling: the 3D floor's promised "instanced proxy beyond 48 agents" doesn't exist in code (full character rigs + an O(n²) collision loop render for every seat, and only 40 desk slots exist), and the Fleet roster grid has no search/filter/virtualization for its heavyweight `SeatCard`s. Fix both and the UI stops being the bottleneck on throughput before the guardrails ever are.

---

## 5. Deferred P2 (lower priority — address after P0/P1 burn-down)

### campaigns

- [ ] **[P2][structure]** `src/components/campaigns/campaign-card.tsx:12` — `STATUS_TONE` map duplicated verbatim in `campaign-card.tsx` and `campaigns/[id]/page.tsx:100-108`; a new status/tone change is easy to update in one place and forget the other. **Fix:** Hoist to a shared module (e.g. `lib/rules.ts` or `lib/utils.ts`) and import from both.
- [ ] **[P2][ux]** `src/app/campaigns/[id]/page.tsx:554` — Overview's "Avg match" tile uses `scoreTone(m.avgMatchScore)`; for a freshly created, zero-candidate campaign this defaults to 0 and renders alarming red for a campaign that simply hasn't started sourcing — inconsistent with the neighboring chart's proper "No scores yet" empty state. **Fix:** Special-case tone to neutral when `m.sourced === 0`.
- [ ] **[P2][perf]** `src/lib/store.ts:4308` — `useCampaignCandidates`/`useCampaignOutreach` and inline reply/booking filters re-filter the entire global arrays on every render with no memoization, returning new references each time. Invisible at demo scale, an O(n) full-array rescan per unrelated re-render at enterprise scale. **Fix:** Wrap selectors in `useMemo` keyed on source array + campaignId, or maintain a campaignId-indexed Map.
- [ ] **[P2][code]** `src/app/campaigns/[id]/page.tsx:313` — Tab selection and candidate-drawer state are plain `useState` with no URL sync and no reset tied to the `id` route param; App Router can reuse the mounted instance across `/campaigns/[id]` navigations (browser back/forward) without remount, risking the drawer briefly showing a candidate from the previous campaign. **Fix:** Sync `tab` to a query/hash param, and add `key={id}` on the page root or reset local state in a `useEffect` keyed on `id`.
- [ ] **[P2][ux]** `src/lib/recommendations.ts:255` — No bulk action exists to act on the idle/stalled campaign list `deriveRecommendations` already computes (see lever #1 above); a recruiter must open each flagged campaign individually. **Fix:** covered by the campaigns 10x lever above.
- [ ] **[P2][ux]** `src/lib/recommendations.ts:71` — `KIND_HREF` sends every recommendation kind to a generic hub page rather than the specific entity, even though `entityId` is known; `source_campaign` clicks land on `/campaigns` instead of the specific campaign. **Fix:** Deep-link `source_campaign` (and other kinds where feasible) to `/campaigns/${entityId}`.
- [ ] **[P2][data]** `src/app/campaigns/[id]/page.tsx:266` — `WeightsEditForm.save` clamps weights to `Math.max(0, ...)` but never validates the sum is non-zero; `scoreCandidate`'s `totalWeight` falls back to `|| 1` when weights sum to 0, silently re-scoring every candidate to 0 with no warning. **Fix:** Block save (or warn inline) when the sum of draft weights is 0.
- [ ] **[P2][ux]** `src/app/campaigns/[id]/page.tsx:641` — "Source next batch"/"Run sourcing agent" are only disabled when `c.status === "Paused"`; a `Filled` campaign still has both fully enabled, allowing continued sourcing/agent runs against a closed req. **Fix:** Extend the disabled condition to also cover `c.status === "Filled"` with a matching tooltip.

### ai-surfaces

- [ ] **[P2][code]** `src/lib/ai/obscura-launcher.ts:48` — Hardcoded, developer-machine-specific absolute path (`/Users/tony/.gemini/antigravity/obscura_bin/obscura`) baked in as a binPath fallback; will never resolve on any other machine (teammate, CI, prod). **Fix:** Drop the hardcoded personal path; rely solely on `OBSCURA_BIN_PATH` env var with the existing `"obscura"` PATH fallback, documented in README/.env.example.
- [ ] **[P2][structure]** `src/lib/ai/hermes.ts:39` — `hermesAvailable(settings)` and `hermes-runtime.ts`'s `hermesRuntimeAvailable(settings)` are byte-for-byte identical, defined in two files, imported by different components — risk of silent drift. **Fix:** Keep one canonical export and have the other re-export it.
- [ ] **[P2][ux]** `src/app/chat/page.tsx:39` — Poll failures are indistinguishable from legitimate empty states (Aria-sessions poll and `file-browser.tsx`'s listing poll both collapse errors into "no data" copy with no retry affordance). **Fix:** Track a distinct `error` state separate from null/empty data and render a "Couldn't reach the Aria runtime — retry" message with a retry button.
- [ ] **[P2][ux]** `src/components/curator/file-browser.tsx:89` — Every listing entry, including plain files, is wrapped in an interactive `<button>`; clicking a file does nothing, which looks broken. **Fix:** Only wrap directory rows in an interactive button; render file rows as static list items or wire a real download/preview action.
- [ ] **[P2][code]** `src/components/chat/chat-thread-view.tsx:136` — The top-level "Thinking…" indicator is effectively dead UI since `sendChat` already appends a `pending:true` bubble with its own indicator. **Fix:** Remove the redundant top-level block.

### agent-3d

- [ ] **[P2][a11y]** `src/components/memory/memory-panel.tsx:127` — Pin/edit/delete action buttons are shown only via `opacity-0 group-hover:opacity-100` with no `group-focus-within`/`focus-visible` equivalent — invisible to keyboard-only users while still tab-focusable (WCAG 2.4.7). **Fix:** Add `group-focus-within:opacity-100` alongside the existing hover class.
- [ ] **[P2][a11y]** `src/components/floor3d/retro/objects/RobotAgentModel.tsx:124` — Selecting an agent in 3D floor mode is only reachable via mouse click on the 3D mesh; no keyboard path, and `<Canvas>` carries no aria-label/role. **Fix:** Mark the 3D canvas region with an aria-label pointing keyboard/screen-reader users to the 2D grid view equivalent.
- [ ] **[P2][structure]** `src/components/floor3d/retro/core/avatarProfile.ts` — 133-line deterministic humanoid avatar generator ported from Claw3D, never imported anywhere in the app (confirmed via repo-wide grep) — dead code from the merge. **Fix:** Delete the file, or wire it into `RiggedCharacter`'s per-instance material-tinting path if avatar customization is actually on the roadmap.

---

## Notes on dedup

Findings were cross-checked across the three clusters for near-duplicates by file path. No true duplicates were found — each cluster's findings touch distinct files/areas (the one file that appears in two clusters, `src/lib/store.ts`, is flagged at different line numbers for unrelated issues: unmemoized campaign selectors at `:4308` in the campaigns audit vs. an unwired `cancelChat` action at `:3904` in the ai-surfaces audit). No findings were dropped.
