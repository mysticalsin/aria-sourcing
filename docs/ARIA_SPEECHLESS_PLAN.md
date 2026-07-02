# Aria (Hermes Sourcing) — The "Speechless" Demo Execution Plan
*Fable build spec for Sonnet. Next 16 / React 19 / R3F / one hydrated client store / synthetic data / mock-with-silent-live-fallback / drafts-only. Every path below was verified against the repo before writing.*

---

## 1. North Star

One recruiter opens Aria, presses **⌘K**, and types a single English sentence — *"source 15 backend engineers for the Berlin fintech role, draft outreach to the strong ones, and book anyone perfect."* A five-step plan materializes, ticks green one rung at a time, and on the **3D office floor** robots physically stand, walk to their desks, and fire glowing cyan data-packets to the hub as each step fires — while a glass **Mission Control HUD** counts *Sourced 15 · Scored 11 · Drafted 9 · Booked 0* upward in real time. Candidates don't appear as a toast; they **stream in one by one**, each name typing out, each fit-score spinning 0→92, each six-axis radar drawing itself into a distinct silhouette. The run halts on a pulsing **"Ready for your approval — nothing sent."** Then the recruiter presses one more button — **"Watch Aria work"** — puts their hands down, and the whole funnel runs itself hands-free as a cinematic: the camera swoops between robots, KPIs climb, a reply beacon flashes red, a violet calendar tile lands on a rising chord, and a result card reads *"1 hire booked in 22 seconds — 6 drafts, all human-approved."* Finally a skeptic clicks a single robot and watches its **mind think in glass** — reasoning tokens, a tool-ladder lighting rung by rung, guardrail chips flashing red-then-green as the suppression check drops an unsubscribed candidate mid-thought. The pitch — *10-20x output, fully autonomous, human always in control* — is never claimed. It happens on screen, in ninety seconds, and the room goes quiet.

---

## 2. The Signature Moves

### 2.1 Aria Command — one sentence runs the whole funnel  `L`
**What:** The ⌘K palette gains a natural-language lane. An unmatched query routes to a deterministic command-grammar parser that compiles the sentence into an ordered `AriaPlan` of **existing** store actions, previews it as a checklist (nothing runs blind), then sequences the real actions and narrates each result. A silent live-LLM upgrade path reuses the app's existing three-layer fallback.
**Demo moment:** Type the Berlin sentence → a 5-step plan snaps in → ticks green: *"Matched campaign · Sourced 15 · 11 scored ≥80 · 9 drafts queued · 2 invites drafted"* → lands on a pulsing *"Ready for your approval — nothing sent."*
**Why revolutionary:** The 10-20x promise made literal — plain English becomes a running recruiting operation in 10 seconds, held exactly at the approval gate.
**Honesty/guardrail:** Plan is **always previewed** before execution; deterministic grammar is the default (LLM only upgrades); the approval gate means a mis-parsed plan still sends nothing.

### 2.2 The Living Floor + Mission Control — the marquee wired to real data  `M`
**What:** A lightweight in-memory event bus (`src/lib/agent-events.ts`) that store actions emit into. The 3D floor subscribes: the responsible robot flips to `working` (already triggers walk-to-desk in `agentTick`), and a pooled FX layer flies a colored glowing packet to a central hub — cyan=source, tangerine=approved draft, red beacon=hot reply, violet tile=booking — each with a WebAudio cue. Over the canvas floats a glass **Mission Control HUD**: count-up scoreboard bound to **real** ledger/candidate-stage selectors, a throughput sparkline, and floating troika labels over the active/selected robot.
**Demo moment:** Click "Source next batch" → within a frame a robot's eyes flare, it rises, walks, and a cyan packet arcs to the hub with a rising chime; the HUD's *Sourced* counter flips with a green pulse and the sparkline nudges up.
**Why revolutionary:** The single biggest asset stops being a screensaver and becomes NASA-grade telemetry — an autonomous workforce answering your clicks.
**Honesty/guardrail:** Counters bind to **real** store selectors, never a theatrical incrementer. FX pooled + hard-gated behind `getDeviceQuality`/`MAX_3D_AGENTS`; the FX layer only **reads** `renderAgentsRef`, never mutates nav; 2D text ticker is the guaranteed fallback.

### 2.3 Materialize + Watch Aria Work — toasts become a machine you watch  `M`
**What:** A reusable reveal layer (`fit-radar.tsx`, `useTypewriter`, `useCountUp`, a skippable reduced-motion-safe reveal wrapper) that stages **already-committed** results: candidate cards cascade in one every ~400 ms, names type out, score dials spin up, six-spoke radars draw from each candidate's **real** score breakdown. "Watch Aria Work" chains this into a per-campaign run — source → score → draft-outreach — that streams into the pending-approval lane and stops at the gate for bulk-approve.
**Demo moment:** On a campaign, click "Run Aria" → six cards fly in with scores, an outreach body types itself under the top card, the queue counter climbs 12→31 behind a green "Human approves before send" pill.
**Why revolutionary:** The AI's intelligence is currently invisible (atomic toasts). Here you watch a mind evaluate humans — a live production line of scored talent.
**Honesty/guardrail:** The mock resolves instantly, so this is **presenting committed results as they're scored**, never implied live token streaming. Radar binds strictly to `matchBreakdown`. Fully skippable so 40+ candidates never drag.

### 2.4 Aria Live — one key runs the entire hire, hands-free  `L`
**What:** A choreographer (`src/lib/demo/aria-live.ts`) that drives the **real** actions on an **event-gated** timeline (never fixed sleeps): source → draft → **approve (drafts-only)** → seed inbound reply → book → report. Each step emits into the event bus so the floor animates and a director-camera glides to the acting robot. KPI tiles count up for free (they already read store state). Ends on a result card. Fully Skip/Restart-able with a reduced-motion toast-montage fallback.
**Demo moment:** Click "Watch Aria work" → camera swoops onto the floor → cyan packets fly, the gate pill flips green, a red reply-beacon flashes and the camera cuts to the responder, a violet calendar tile lands on a rising chord → *"1 hire booked in 22 seconds — 6 drafts, all human-approved."*
**Why revolutionary:** The product demos itself end-to-end while you sit on your hands — the missing hero narrative for a product whose whole pitch is autonomy.
**Honesty/guardrail:** The orchestrator calls `approveOutreach` **only** and must never call any send/dispatch action — asserted in code and in the verification gate. Every transition gates on an action's resolved return or its bus event, so mock-vs-live latency can't desync it.

### 2.5 Glass Cortex + Glass-Box Approval — the black box made glass  `M`
**What:** Click any robot → a Cortex drawer reconstructs that seat's work from the real `agentActivity()` derivation and dramatizes it: a streaming thought log, a tool-ladder lighting rung by rung, confidence meters from the candidate's real 6-dim breakdown, and guardrail chips (Dry-run / Suppression / Personalization) flashing red-then-green as each check trips. Its sibling, **Glass-Box Approval**, renders `checkOutreachApproval` in the outreach queue as an animated PASS/BLOCK/WARN checklist with the fit radar and a claim-to-signal map; blockers visibly grey out Approve.
**Demo moment:** Click an orange robot mid-walk → the panel types *"top match: Amélie R, fit 0.86… checking suppression ledger… FLAG: unsubscribed 2024 — dropping, logged."* The suppression chip flashes red, the ladder skips the "draft" rung.
**Why revolutionary:** Nobody exposes a per-agent decision stream tied to a named avatar on a 3D floor. The guardrails stop being marketing copy — you watch them halt the machine mid-thought.
**Honesty/guardrail:** The trace is seeded from the seat's **actual** current candidate + real suppression/score facts, so each robot's cortex differs and mutates with the store. Claim-to-source maps at signal level (skills/tenure/activity/company), labeling unmatched claims "general" rather than faking a source.

---

## 3. Phased Roadmap

**Sequencing logic:** Two primitives — the **event bus** and the **reveal layer** — are dependencies for almost everything downstream, so they land first inside Phase 1 alongside the first jaw-drop. Phase 2 multiplies throughput. Phase 3 is the cinematic/moonshot layer that composes Phases 1–2. Phase 4 makes trust a visible artifact and cleans friction. Effort: **S** ≈ ½–1 day, **M** ≈ 2–3 days, **L** ≈ 4–6 days for one Sonnet stream.

### Phase 1 — Wow Foundation: the floor comes alive, results stream in

| Workstream | Goal | Files to create / change | Acceptance criteria | Effort | Deps |
|---|---|---|---|---|---|
| **1.1 Agent event bus** | One typed pub/sub singleton every feature reuses; zero store-shape change | **New** `src/lib/agent-events.ts` (`AgentEvent {seatId?, kind:'source'\|'send'\|'reply'\|'book'\|'allocate', candidateName?, campaignId?, count?, at}`, `emit()`, `subscribe()`, bounded ring buffer). Add `emit()` inside existing callbacks in `src/lib/store.ts`: `sourceNextBatch` (impl ~L933), `approveOutreach` (~L1532), `classifyAndStoreReply` (~L1902), `createBookingFor` (~L2314), `allocateOutreach`/`generateOutreachFor` (~L1153) | `subscribe` fires within one tick of each action resolving; ring buffer capped (≤64); no persisted state added; `tsc` clean | S | — |
| **1.2 The Living Floor (FX + status pulse)** | Robots physically enact real events; 2D fallback never blank | Extend `RenderAgent` in `src/components/floor3d/retro/core/types.ts` with transient `pulseUntil?`/`emit?` (read-only in FX). **New** `src/components/floor3d/retro/scene/PacketFX.tsx` (pooled glowing sprites via `useFrame`, reads live positions from `renderAgentsRef`, disposes on completion). Mount in `RetroOfficeScene.tsx`; resolve emitting seat → a **shown** agent (or CEO hub) before animating. Extend `SoundKind` in `src/lib/sound.ts` (`'packet'\|'ping'\|'beacon'\|'chord'`). `src/app/floor/page.tsx` subscribes + renders a text **activity ticker** for 2D/weak devices. **Do NOT touch** `agentTick` nav/collision code — status-flip already drives walk-to-desk | Clicking Source/Approve/Reply/Book on any page animates the correct robot within ~1 frame with the right color+sound; caps + `webglcontextlost` guard (`Floor3D.tsx:84`) intact; reduced-motion & low tier show ticker only; no per-frame alloc leak (sprites pooled) | M | 1.1 |
| **1.3 Reveal primitives** | Shared, skippable, reduced-motion-safe reveal system | **New** `src/components/charts/fit-radar.tsx` (self-contained SVG polygon, animated `stroke-dashoffset` draw-in; matches existing custom-chart convention in `src/components/charts`). **New** hooks `useTypewriter`, `useCountUp`, and `src/components/reveal/reveal-stream.tsx` (framer-motion staggered reveal, `Skip` control, honors `prefers-reduced-motion`) | Radar plots **real** `matchBreakdown` (`types.ts:298`, item `types.ts:229`) — distinct silhouettes per candidate; Skip instantly resolves to final state; reduced-motion renders final frame with no animation | M | — |
| **1.4 Materialize (streaming sourcing feed)** | Sourcing stops resolving atomically | **New** `src/components/tania/sourcing-feed.tsx` (uses 1.3). Thin reveal wrapper around the **unchanged** `sourceNextBatch` result on `src/app/campaigns/[id]/page.tsx` (sourcing tab) and `src/app/candidates/page.tsx`. Drop `<FitRadar>` into `src/components/candidates/candidate-drawer.tsx` next to the existing score gauge | Triggering sourcing streams cards ~1/400 ms with typewriter name + count-up score + radar draw-in; store mutation unchanged (verify counts identical to pre-change); Skip works; each materialized card also fires a 1.1 event so the floor reacts | M | 1.1, 1.3 |
| **1.5 Mission Control HUD** | Reframe the floor as an ops nerve center | **New** `src/components/floor/mission-control-hud.tsx` (glass overlay absolutely positioned over the canvas in `src/app/floor/page.tsx`; count-up + delta-flash on 1.1 subscription; values from `useLedger`/`useCandidates` selectors — **real deltas**). Corner sparkline reuses the custom SVG chart pattern. Floating 3D labels: small component in `RetroOfficeScene.tsx` using `troikaConfig.ts`, positioned from `renderAgentsRef`, **hard-capped to active+selected agent** and tier-gated. Activity text from `agentActivity()` (`src/lib/floor.ts:38`) | Scoreboard values equal the real selector outputs (inspect: no fake incrementer); counters animate only on event; HUD sits outside orbit-controls hit area (camera drag still works); labels never exceed 2 at once | M | 1.1 |

**Phase 1 exit = the 30-second holy-shit is real:** any operator action visibly moves a robot, streams scored candidates, and ticks a HUD bound to true state.

### Phase 2 — The 10-20x Throughput: breadth, autonomy, bulk-everything

| Workstream | Goal | Files to create / change | Acceptance criteria | Effort | Deps |
|---|---|---|---|---|---|
| **2.1 Aria Command** | One sentence → previewed plan → executed at the gate | **New** `src/lib/aria-command.ts` (`parseCommand(text): AriaPlan` — deterministic grammar: verbs source/draft/follow-up/book/pool/report + entities role, city, count N, campaign-match; optional live path reusing `tool-loop.ts`/intake fallback). **New** `src/components/aria/command-console.tsx` (plan checklist + Run + per-step status). Extend `HermesActions` (`store.ts:146`): add `runAriaPlan(plan, onStep)` sequencing existing callbacks (`createCampaignFromAnalysis`→`sourceNextBatch`/`runSourcingAgent`→`generateOutreachLive`→`allocateOutreach`→`createBookingFor`). Add NL fallback branch in `src/components/app/command-search.tsx` routing unmatched ⌘K queries to the console. Upgrade the `askAria` stub (`store.ts:340`) to delegate here | Berlin sentence yields a correct 5-step plan **shown before running**; steps tick green with real result counts; run halts with drafts in the queue, 0 sent; a nonsense sentence yields a safe/empty plan, never a wrong destructive run | L | 1.1, 1.4 |
| **2.2 Sourcing War Room** | One paste of a 6-role brief → 6 live campaigns in parallel | **New** route `src/app/launch/page.tsx` (or a "Batch" tab on `src/app/intake/page.tsx`). Reuse `parseIntakeLive()` (`src/lib/ai/intake.ts:206`) per JD block — split on explicit `---`/N textareas as the offline-safe default, optional multi-role LLM split via a new prompt in `buildIntakeParsePrompt` (`:88`) with silent fallback. Loop `createCampaignFromAnalysis` per role, then `Promise.all` over `runFleetSourcing`/`sourceNextBatch` with staged reveal. **New** `src/components/launch/war-room-board.tsx` (one lane per role reading `useCampaigns`/`useCampaignCandidates`; framer-motion count-up + lane stagger) | Paste 6 roles → 6 lanes snap in → sourced counts climb in parallel → header reads "N sourced across 6 roles, 0 sent — awaiting approval"; `---`-delimited paste works with zero network; each lane emits 1.1 events so the floor fans out | L | 1.1, 1.4 |
| **2.3 Bulk personalized outreach** | Kill the "spam at scale" objection with visible personalization proof | In `src/app/candidates/page.tsx` bulk toolbar (reuse `selectedIds`/`visibleSelectedIds`), add "Draft personalized outreach for selected" looping `generateOutreachFor(id)` with a `Progress` meter. Surface `personalizationEvidence` (produced by `mock-ai.ts:960`, type field `types.ts:516`) as a "why this person" chip in the outreach queue row (`src/app/outreach/page.tsx`) and drawer; **confirm the field is persisted by `newOutreachMessage`** and thread it through if not. Weak profiles fall back to a role/skill hook, never an empty chip | Select 40 → 40 drafts land in seconds, each with a **distinct** evidence chip; concurrency throttled (see 4.x pattern); the personalization-required rule in `approveOutreach` still enforced | M | — |
| **2.4 Follow-up Autopilot** | Clear the whole due backlog in one click, sequence-aware | In `src/app/outreach/page.tsx`, add "Draft all due follow-ups" above the FollowUpDue list, mapping `useFollowUpsDue()` and awaiting `draftFollowUpFor(item.candidateId)` per item, **throttled with a small concurrency cap** + `Progress`. **New** `src/components/outreach/sequence-ladder.tsx` rendering `nextSequenceStep`/`daysSinceContact` from `deriveFollowUpsDue` (`src/lib/recommendations.ts:137`). No store change — `draftFollowUpFor` (`store.ts:1312`) already lands each draft at the right step | "47 due" → click → progress bar fills → 47 drafts land tagged "Follow-up #2 · 4d silent" with varied angles; ready-to-approve counter jumps; a 47-item backlog degrades gracefully, never freezes the store | M | — |
| **2.5 Watch Aria Work** | A single "Run Aria" streams source→score→draft into the gate | **New** `src/components/run/agent-run-stream.tsx` — client orchestrator calling `sourceNextBatch(campaignId)` then looping `generateOutreachFor(candidateId)` with staged reveals (reuse 1.3) + a cosmetic token-stream for the body. Add "Run Aria" CTA to `src/app/campaigns/[id]/page.tsx` and `src/app/page.tsx`. Optional SSE upgrade to existing `/api/sourcing-agent` (`runSourcingAgent`, `store.ts:1054`) with silent mock fallback | Cards stream with scores, a body types out, queue counter climbs behind the gate pill; run **pauses at the gate**, 0 sent; bulk-approve clears the batch; client-side staged version works with zero network | M | 1.1, 1.3, 1.4 |

### Phase 3 — Cinematic Autonomy: the hero narrative & moonshots

| Workstream | Goal | Files to create / change | Acceptance criteria | Effort | Deps |
|---|---|---|---|---|---|
| **3.1 Aria Live (Demo Director)** | One key runs the full hire hands-free with camera cuts | **New** `src/lib/demo/aria-live.ts` (async orchestrator: `source→draft→approve→classifyAndStoreReply(seed)→createBookingFor→generateReport`, each transition **gated on the action's resolved return or its 1.1 bus event**, never a bare `setTimeout`). **New** director-camera hook in `RetroOfficeScene.tsx` (lerp OrbitControls target to the acting robot's live `renderAgentsRef` position; falls back to establishing shot). Trigger in `src/components/app/topbar.tsx` + a ⌘K entry in `command-search.tsx`. **New** overlay `src/components/demo/aria-live-overlay.tsx` (framer-motion letterbox + caption rail + chapter progress + Skip/Restart + result card). Snapshot/restore the store via existing persistence before play so the run is non-destructive | Full funnel plays hands-free in ~20 s; camera tracks each acting robot; KPIs count up live; ends on the result card; **Skip/nav-away restores the store snapshot**; captions never desync from state; asserts drafts-only (see gate) | L | 1.1, 1.2, 1.5, 2.5 |
| **3.2 Glass Cortex** | Click a robot → watch its mind think | **New** `src/lib/cortex.ts` (`agentCortexTrace(seat, state)` builds a deterministic-yet-alive script from `agentActivity()` + the seat's real current candidate; reuses `classifyReply` reasoning strings + the 6-dim breakdown; exposed as a word-by-word async generator). **New** `src/components/floor/agent-cortex.tsx` — Drawer opened from `floor/page.tsx`'s existing `selectedId`; streaming log + SVG tool-ladder + framer-motion confidence meters + guardrail chips read from `useSuppression`/`useLedger`. No data-model change | Each robot's cortex differs (seeded from its real candidate + suppression/score facts) and mutates with the store; a suppressed candidate visibly trips the chip red and skips the draft rung; pacing reads as "thinking," not "loading" | M | 1.2 |
| **3.3 Autopilot Replay (DVR)** | Scrub the agents' whole day; the floor re-enacts it | **New** `src/lib/replay.ts` (`buildEventStream(state): ReplayEvent[]` from existing per-entity timestamps — candidate `createdAt`/`lastContactedAt`, outreach `sentAt`, reply `receivedAt`, booking/report timestamps + seeded activities; `replayStateAt(state, cursorMs)` returns revealed subset + a synthetic `OfficeAgent[]` whose seats flip `working` inside a ±window). **New** route `src/app/replay/page.tsx` + one `nav.ts` entry. **New** `src/components/replay/run-timeline.tsx` (SVG multi-lane chart + draggable playhead + play/2x/8x via `requestAnimationFrame`, `playSound` on event-cross). Add an optional `agentsOverride` prop path to `Floor3D` so the derived `OfficeAgent[]` drives the existing `agentTick` working→desk animation for free | Dragging the playhead reveals cards + re-enacts floor robots in lockstep; scrubbing back un-reveals; stream precomputed once + binary-searched (no per-frame re-derive); floor override throttled to state updates, not per-frame | L | 1.2 |
| **3.4 Hey Aria (voice)** | Push-to-talk hands-free ops, add-on to the same parser | **New** `src/lib/voice/aria-voice.ts` (guarded wrapper over `SpeechRecognition`/`webkitSpeechRecognition` STT + `speechSynthesis` TTS, feature-detect + fallback). **New** `src/lib/voice/intent.ts` reusing 2.1's grammar → action descriptor. **New** `src/components/app/voice-console.tsx` in `topbar.tsx`: push-to-talk button, live transcript chip, dispatches `useActions()`, speaks the resulting toast text, flashes the target nav item | Spoken "source twenty backend engineers… and draft outreach" runs the real actions and speaks a one-line summary; **STT is an opt-in labelled toggle** (Chromium-only caveat); TTS + typed fallback work with zero network; recognition misses never trigger a destructive run (routes through the previewed plan) | M | 2.1 |

### Phase 4 — Enterprise Trust & Scale + friction cleanup

| Workstream | Goal | Files to create / change | Acceptance criteria | Effort | Deps |
|---|---|---|---|---|---|
| **4.1 Glass-Box Approval** | The guardrail engine visible on every send | Additive refactor of `src/lib/rules.ts`: extend `ApprovalResult` (`:28`) with `checks: {rule; status:'pass'\|'warn'\|'block'; detail}[]` **alongside** existing `blockers`/`warnings` (non-breaking). **New** `src/components/outreach/glass-box-panel.tsx` (animated checklist + `<FitRadar>` from 1.3 + claim-to-signal map), mounted in `src/app/outreach/page.tsx`. Reuse `matchBreakdown` + `personalizationEvidence` | Six checklist rows animate green one-by-one; toggling do-not-contact flips one red and **greys out Approve instantly**; hovering a personalization sentence lights the candidate signal (skills/tenure/activity/company); unmatched claims labeled "general" | M | 1.3 |
| **4.2 Decision Replay (Audit Time Machine)** | Turn dead Sessions into courtroom-grade replay | **New** selector `useEntityTimeline(linkedEntityType, linkedEntityId)` in `store.ts` grouping `useActivities()` (`:5151`) by `linkedEntityId` (`types.ts:581`) + merging outreach/replies. **New** `src/components/sessions/decision-replay.tsx` (framer-motion scrubber + evidence rail switching on `activity.type`: scored→`matchBreakdown`, drafted→`personalizationEvidence`, approved→`ApprovalResult` + who/when). Rework `src/app/sessions/page.tsx` so a row opens the replay Drawer. **New** `src/components/sessions/audit-pack.tsx` (print-styled). Synthesize a canonical chain from `stage`+`outreachHistory`+replies when activities are thin | Any candidate replays sourced→scored→drafted→approved→replied→booked with the "why" + human signature per step; sparse candidates still get a coherent chain; export prints a paginated trace | M | — |
| **4.3 Trust & ROI Proof Center** | The page the buyer signs on — falsifiable ROI + compliance | **New** `src/app/trust/page.tsx` + grouped `nav.ts` entry. **New** `src/components/trust/roi-calculator.tsx` (counts from `useActivities`/`useCandidates`/`useOutreach`/`useBookings`; buyer-editable assumptions; "How we counted" drawer citing activity counts). **New** `src/components/trust/compliance-posture.tsx` (reveals from `recordPiiReveal`, `complianceFlags`, `useLedger`/`useSuppression` adherence; each tile deep-links into 4.2). Optional `proof-pill.tsx` in `topbar.tsx` | Dragging the cost slider recomputes the multiple + annual saving live; every number = editable assumption × auditable count; page labeled **"illustrative on synthetic data"**; compliance tiles open Decision Replay | M | 4.2 |
| **4.4 Consent Passport & Data Lineage** | GDPR made physical, per candidate | **New** `src/components/candidates/consent-passport.tsx` in `candidate-drawer.tsx` (source/lawful-basis chips from `sourceUrl`; retention countdown from the compliance retention setting − record age; reveal ledger filtered from `useActivities` by `linkedEntityId` + reveal type). Small `ProvenanceChip` in `candidates/page.tsx` rows. Optional `lawfulBasis`/`provenance` on `Candidate` (`types.ts`) + seed; else derive | Revealing a masked candidate writes a visible ledger row (operator + time + purpose); retention chip counts down; **labeled "illustrative compliance model on synthetic data"**; bases are display chips, not enforced legal logic | M | — |
| **4.5 Watch It Learn** | The self-improving Skills loop, visual and real | **New** `src/components/skills/learning-session.tsx` (streamed review → reveal). **New** `src/lib/diff.ts` (tiny word-level LCS, no dep). **New** `src/components/charts/impact-bar.tsx` (custom SVG before/after). Wire into `src/app/skills/page.tsx` + proposal cards in `src/app/reports/page.tsx`. Reuse `runLearning` (`store.ts:318`), `acceptSkillLearning` (`:319`), `updateSkillContent`, `AgentSkill.history/params/metrics` (`types.ts:623`) | Review streams from **real** `metrics.outcomeSignal` + reply counts (never fabricated); a red/green word-diff of the playbook renders; Accept advances the version and **mutates `AgentSkillParams` for real** so the next `generateOutreachLive` uses the learned tone; large diffs capped/virtualized | M | 1.3 |
| **4.6 Friction cleanup (nav + dead pages)** | No "enable live mode" dead-ends; grouped nav | Group `src/components/app/nav.ts` into sections (Operate / Analyze / System) with the new `/launch`, `/replay`, `/trust` entries. Give `/curator`, the `/soul` & `/memory` right rails, and Chat's sessions pane rich **synthetic/mock** states behind `hermesRuntimeAvailable(settings)` so a demo never hits a live-mode stub | Every nav route renders meaningful content in the demo build; no "Enable Aria live mode" stub visible with default settings; nav scannable (sectioned) | S–M | — |

---

## 4. Data-Model & Architecture Changes (build these foundations once)

**New library modules**
- `src/lib/agent-events.ts` — `AgentEvent` type, `emit`/`subscribe`, bounded ring buffer. *No store-shape change.*
- `src/lib/aria-command.ts` — `AriaPlan` type + `parseCommand()` grammar + optional live path.
- `src/lib/replay.ts` — `ReplayEvent` type, `buildEventStream(state)`, `replayStateAt(state, cursorMs)`. *Derived only, no persisted data.*
- `src/lib/cortex.ts` — `agentCortexTrace(seat, state)` async token generator.
- `src/lib/demo/aria-live.ts` — event-gated choreographer.
- `src/lib/voice/aria-voice.ts` + `src/lib/voice/intent.ts` — guarded STT/TTS + intent parser.
- `src/lib/diff.ts` — word-level LCS diff.

**Type changes (all additive / non-breaking)**
- `src/components/floor3d/retro/core/types.ts` → `RenderAgent`: add transient `pulseUntil?`, `emit?` (read-only in FX).
- `src/lib/rules.ts` → `ApprovalResult` (`:28`): add `checks: {rule; status; detail}[]` alongside `blockers`/`warnings`.
- `src/lib/types.ts` → `Candidate`: optional `rationale?: string`; optional `lawfulBasis`/`provenance` (4.4). Confirm `personalizationEvidence` (`:516`) is persisted on the outreach message record; thread through `newOutreachMessage` if not.

**Store surface (`src/lib/store.ts`, `HermesActions` at `:146`)**
- Add `runAriaPlan(plan, onStep)` sequencing existing callbacks.
- Add selector `useEntityTimeline(linkedEntityType, linkedEntityId)`.
- Add `emit()` calls inside existing callbacks: `sourceNextBatch` (~933), `approveOutreach` (~1532), `classifyAndStoreReply` (~1902), `createBookingFor` (~2314), `allocateOutreach`/`generateOutreachFor` (~1153). **No new persisted fields, no change to `withActivity` (`:767`) audit semantics.**
- Upgrade `askAria` (`:340`) to delegate to `runAriaPlan`.

**Sound**
- `src/lib/sound.ts` → extend `SoundKind` with `'packet'|'ping'|'beacon'|'chord'`.

**New UI components / charts / routes**
- Charts: `fit-radar.tsx`, `impact-bar.tsx`, corner `sparkline` (custom SVG, matching `funnel-chart.tsx`/`score-gauge.tsx` convention).
- Reveal: `reveal-stream.tsx`, `useTypewriter`, `useCountUp`.
- Floor: `PacketFX.tsx`, `mission-control-hud.tsx`, `agent-cortex.tsx`, director-camera hook.
- Routes: `src/app/launch/page.tsx`, `src/app/replay/page.tsx`, `src/app/trust/page.tsx` (+ grouped `nav.ts`).

**API routes:** **none required.** Every orchestrator is client-side. Optional-only silent-fallback SSE upgrade to the existing `/api/sourcing-agent`. No new integrations invented.

---

## 5. Demo Script (minute-by-minute — the gasps)

**0:00 — Command.** Open Aria on the Command Center. Press ⌘K, type *"source 15 backend engineers for the Berlin fintech role, draft outreach to the strong ones, and book anyone perfect."* A 5-step plan snaps in as a checklist. Press Enter. Steps tick green: *Matched campaign · Sourced 15 · 11 scored ≥80 · 9 drafts queued · 2 invites drafted*. Lands on **"Ready for your approval — nothing sent."** *(2.1, 1.4)*

**0:30 — The floor answers.** Switch to /floor. The Mission Control HUD reads *Sourced 143 · Drafted 44 · Approved 31 · Booked 6*. Back on /candidates, click **Source next batch** — cut to the floor: a robot's eyes flare, it walks to its desk, a cyan packet arcs to the hub with a rising chime, the HUD's *Sourced* counter flips with a green pulse, the sparkline nudges up. *(1.2, 1.5, 1.1)*

**1:15 — Watch it materialize.** On the campaign sourcing tab, results don't toast — cards **stream in**: *"Consultant — Murex/FpML"* types out, the dial spins to 92, a six-spoke radar draws itself into a spiky high-fit silhouette. Then the next, then the next. *(1.4, 1.3)*

**2:00 — Bulk with proof.** On /candidates, select 40, click **Draft personalized outreach**. Forty drafts appear in seconds, each with a distinct evidence chip — *"opened with: your 3.1k-star retrieval repo"*, *"your 4y at a Series-B fintech."* Open /outreach: a draft's **Glass-Box** panel ticks six green checks; toggle the candidate to do-not-contact and one flips red — **Approve greys out instantly.** *(2.3, 4.1)*

**2:45 — The whole backlog, gone.** /outreach shows *"47 follow-ups due."* Click **Draft all** — a progress bar fills, 47 step-aware drafts land tagged *"Follow-up #2 · 4d silent."* *(2.4)*

**3:15 — Hands off.** Click **Watch Aria work** in the topbar. Screen letterboxes. Camera swoops onto the floor. A robot sources (cyan packets), a second drafts, the gate pill flips green, a red reply-beacon flashes and the camera cuts to the responder, a violet calendar tile lands on a rising chord. KPIs climb the whole time. Result card: **"1 hire booked in 22 seconds — 6 drafts, all human-approved."** No clicks. *(3.1)*

**4:00 — The skeptic's move.** Click one orange robot mid-walk. The Cortex drawer types live: *"top match: Amélie R, fit 0.86… checking suppression ledger… FLAG: unsubscribed 2024 — dropping, logged."* The suppression chip flashes red; the tool-ladder skips the draft rung. *(3.2)*

**4:45 — Prove the receipts.** Open /trust. Drag the recruiter-cost slider $60→$95 — the headline flips *11x→17x*, annual saving recounts live; open "How we counted" — it cites the exact sourced/drafted counts, labeled *illustrative on synthetic data*. Open a hired candidate's **Decision Replay**: the timeline animates *Scored 91 → Drafted (4 personalization points) → Human approved by T. Walteur 14:02 → Replied → Booked.* *(4.3, 4.2)*

**5:30 — (optional) Rewind the day.** On /replay, drag the playhead 6am→2pm: 40 cards cascade, three drafts type, two replies flip to Interested, a booking stamps — and the floor robots walk to their desks in lockstep. Drag back — it un-happens. *(3.3)*

---

## 6. Verification Gate (per phase — Tony's standard: proof, not "the diff looks fine")

Run **all** of the following before a phase is called done; paste the real outputs into the phase review.

1. **Types:** `npx tsc --noEmit` → 0 errors.
2. **Real build (not the rtk stub):** invoke the **real** Next binary — `node ./node_modules/next/dist/bin/next build` — because the rtk hook fakes `next build`/`next lint`/`ls`/`find` (per repo memory). A stubbed "success" is not proof.
3. **Route smoke via Playwright MCP** (browser tools stay **read-only** — navigate/click/scroll/wait only): drive each new/changed route (`/`, `/floor`, `/campaigns/[id]`, `/candidates`, `/outreach`, `/launch`, `/replay`, `/trust`, `/skills`, `/sessions`) and assert **0 console errors** via `browser_console_messages`. Capture a screenshot per headline moment.
4. **Behavioral diff:** for reveal features, assert the store mutation is byte-identical to the pre-change atomic path (same candidate/draft counts) — the reveal is presentation-only. For Aria Live, assert snapshot-restore leaves the store identical after Skip.
5. **Drafts-only assertion (compliance):** grep every orchestrator (`aria-command.ts`, `demo/aria-live.ts`, `agent-run-stream.tsx`, `war-room-board.tsx`) — they call `approveOutreach` only and **never** any send/dispatch action. Add a unit assertion that fails the build if a send is reachable from a choreographer.
6. **Perf/tier gate:** on a simulated low `getDeviceQuality` tier and `prefers-reduced-motion`, confirm PacketFX/Bloom/troika labels are suppressed and the 2D ticker/final-frame fallbacks render; confirm no per-frame allocation growth (sprites pooled) and the `webglcontextlost` guard still recovers.
7. **Unit/integration tests:** run `tsx` suites with the **sandbox disabled** (per repo memory — `npm test`/`tsx *.mts` hit EPERM on a unix socket under the sandbox). Add tests for `parseCommand`, `buildEventStream`/`replayStateAt` (binary-search correctness), `diff.ts` LCS, and the extended `ApprovalResult.checks`.
8. **Staff-engineer check:** would this pass review? Bind counters to real selectors, radars to real breakdowns, ROI to auditable counts — inspect one of each live to confirm nothing is theatrical.

---

## 7. Guardrail Checklist (pre-ship, every PR)

- [ ] **Drafts-only / never auto-send.** No choreographer or bulk action reaches any send/dispatch path; runs stop at `approveOutreach` and the gate pill is on screen throughout.
- [ ] **Human-approval gate intact.** `checkOutreachApproval` still runs; personalization-required + do-not-contact + unsubscribed rules still block; `ApprovalResult.checks` is additive only.
- [ ] **Audit trail intact.** `withActivity`/`makeActivity`/`logActivity` semantics unchanged; new features read the log, never bypass it.
- [ ] **Browser tools READ-ONLY.** Navigate/click/scroll/wait/back/forward only. **No** stealth, anti-bot evasion, form-fill vocabulary, real scraping, or LinkedIn automation — anywhere, ever.
- [ ] **PII guarded.** Reveals go through `recordPiiReveal` and log an activity; Consent Passport/Trust numbers labeled *illustrative on synthetic data*; no real legal determination asserted.
- [ ] **Synthetic data + mock integrations only.** Silent live-API-with-mock-fallback preserved; no new integration invented; hosted-Supabase stays optional.
- [ ] **3D hardening untouched.** `MAX_3D_AGENTS` caps, `getDeviceQuality` tiers, and the `webglcontextlost` guard preserved; FX layer only reads `renderAgentsRef`, never mutates nav/collision.
- [ ] **Honesty of motion.** Reveal streams are "presenting committed results," never implied live token streaming; counters/radars/ROI bind to real state.
- [ ] **Reduced-motion + accessibility.** Every animation honors `prefers-reduced-motion`; reuse existing focus-trap/aria-modal patterns for new drawers/consoles.
- [ ] **Stealth-browser refusal held** (per repo memory) regardless of framing.

---

## 8. Cut List (consciously deferred — 1 line each)

- **Command Bridge free-pilot + Depth-of-Field** — WASD flight and DoF share Phase 3's camera budget and risk a second competing marquee; ship the Aria Live director-camera first, keep DoF a stretch.
- **Candidate Journey Cinematic ("boarding pass")** — its wow overlaps Autopilot Replay + Materialize; folded into those rather than a separate overlay.
- **Time Machine full analytics scrubber** — the KPI-scrub-through-history is largely delivered by Mission Control sparklines (P1) + Autopilot Replay (P3); a dedicated dashboard scrubber is deferred and would need seed-timestamp backfill.
- **Real SSE token streaming** — the client-side staged reveal is the guaranteed baseline; the `/api/sourcing-agent` SSE upgrade is optional polish, not a dependency.
- **Voice STT default-on** — Chromium-only and routes audio to Google; ships as an opt-in labelled toggle, TTS + typed fallback are the default.
- **Interactive Architecture org graph, careers avatar choreography, glowing geo/world map** — high polish, low pitch-leverage versus the autonomy story; deferred.
- **Curator/Files live runtime** — remains behind `hermesRuntimeAvailable`; 4.6 only adds a synthetic demo state, not the real Hermes integration.

---

## Appendix — All 24 scored features (wow / exec / throughput)

- **Aria Command — one sentence runs the whole funnel** — _signature_ · wow 9 · exec 6 · tput 10
- **Mission Control — a live command-deck HUD floating over the 3D floor** — _strong_ · wow 8 · exec 9 · tput 8
- **Sourcing War Room — paste a req list, launch N campaigns in parallel** — _signature_ · wow 8 · exec 8 · tput 9
- **Materialize — watch candidates get sourced and scored in real time** — _strong_ · wow 8 · exec 8 · tput 7
- **Bulk personalized outreach with visible personalization proof** — _strong_ · wow 7 · exec 9 · tput 8
- **Watch Aria Work — streamed autonomous run behind the approval gate** — _signature_ · wow 8 · exec 9 · tput 5
- **Follow-up Autopilot — clear the entire due backlog in one click, sequence-aware** — _strong_ · wow 6 · exec 9 · tput 9
- **"Hey Aria" — voice-driven ops console** — _signature_ · wow 8 · exec 7 · tput 6
- **The Living Floor — bind the 3D office to the real store event bus** — _signature_ · wow 9 · exec 7 · tput 3
- **Demo Director — one-key cinematic autoplay of the entire funnel** — _signature_ · wow 8 · exec 6 · tput 6
- **Glass Cortex — click a robot, watch its mind think** — _signature_ · wow 8 · exec 8 · tput 4
- **Aria Live — one button runs the entire funnel on the floor, hands-free** — _signature_ · wow 9 · exec 6 · tput 3
- **Reasoning Ribbon — watch Aria think, with a rationale for every candidate** — _strong_ · wow 8 · exec 8 · tput 3
- **Autopilot Replay — scrub your agents' day like a video (DVR)** — _signature_ · wow 8 · exec 8 · tput 3
- **Watch It Learn — the self-improving Skills loop, made visual and real** — _signature_ · wow 8 · exec 7 · tput 3
- **Decision Replay — the Audit Time Machine** — _strong_ · wow 8 · exec 7 · tput 3
- **Glass-Box Approval — the guardrail engine, made visible on every send** — _strong_ · wow 7 · exec 8 · tput 4
- **Live Wire — the floor physically reacts to what you click** — _signature_ · wow 8 · exec 7 · tput 2
- **Living Ops Floor — robots physically enact the work** — _strong_ · wow 8 · exec 6 · tput 2
- **Trust & ROI Proof Center — the page the buyer signs on** — _strong_ · wow 7 · exec 8 · tput 2
- **Consent Passport & Data Lineage — GDPR made physical, per candidate** — _strong_ · wow 7 · exec 8 · tput 2
- **Command Bridge — pilot the 3D floor like an RTS command center** — _strong_ · wow 8 · exec 6 · tput 2
- **Time Machine — a scrubbable, animated analytics timeline** — _strong_ · wow 7 · exec 6 · tput 2
- **Candidate Journey Cinematic — the boarding pass** — _strong_ · wow 6 · exec 8 · tput 2
