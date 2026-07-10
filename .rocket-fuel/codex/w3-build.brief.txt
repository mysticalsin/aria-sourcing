You are the Integrator building Rock W3 of the approved Wave-2 plan (.rocket-fuel/PLAN-wave2.md, ROCKS-wave2.md) in the MSourcing repo. workspace-write. Rocks W1 (canonical metrics), W2 (wins), W4 (databricks) shipped — consume them, don't reinvent.

Objective: a clean, read-only exec dashboard at /exec for top management — real sourcing KPIs from the canonical W1 derivation, per-platform + per-campaign funnels, trend sparklines, the wins feed, and an honest "not tracked yet" open-rate tile. No synthetic data in live metrics.

Read first: (understand before editing)
- src/lib/metrics.ts — the canonical exports to CALL (do NOT re-implement filters): isRealSendFact (~118), realFunnelFacts (~143), missionControlHudValues (~203), computeCampaignMetrics (~224), funnelForCandidates (~89), globalKpis. Live metrics must exclude provenance:'synthetic' and non-real sends via these.
- src/lib/store.ts — HermesState slices (candidates, outreach, replies, bookings, ledger, activities, wins from W2), demo-vs-live (supabaseEnabled), dryRunMode.
- src/components/floor/mission-control-hud.tsx — derivation reuse; src/components/charts/trend-spark.tsx — TrendSpark; src/components/trust/compliance-posture.tsx — tile layout pattern; src/app/replay/page.tsx — read-only page pattern; tests/login-page.mts — component test style.
- src/lib/rbac.ts — can(role, ...) / viewer vs admin; src/proxy.ts — page auth gating.
- src/components/app/app-shell.tsx / sidebar — how a nav route is added.

Build:
1. /exec page (src/app/exec/page.tsx): read-only. KPI tiles — candidates sourced, contacted, reply rate, positive-reply rate, meetings booked, time-to-source, avg match score — ALL via metrics.ts canonical exports. Per-platform funnel (group live candidates by sourcePlatform) and per-campaign funnel. TrendSpark sparklines from the real event/activity history. A wins feed section (from state.wins, W2) showing recent wins (PII-appropriate for an internal exec view; respect RBAC below). An open-rate tile rendered as "Not tracked yet" with a one-line note (no email-open events exist) — never a number.
2. Honesty + provenance: in LIVE mode exclude provenance:'synthetic' and non-real sends (use the canonical derivation — it already does). In DEMO mode, show a clear banner "Demo data — synthetic" at the top; do not present demo numbers as real.
3. RBAC: page gated in live (proxy already gates the session). Within the page: viewer sees aggregate tiles + funnels (no per-candidate PII beyond first-name/role in the wins feed, or redact); admin additionally sees the export/download control. Use can(role,...).
4. Nav: add an "Exec" entry to the sidebar/nav consistent with existing items (admin/leadership visibility as appropriate).
5. No Math.random, no hardcoded metric constants anywhere in the exec derivations — every number traces to real state via metrics.ts.

Constraints: (what must NOT change) no changes to metrics.ts canonical semantics (call, don't fork); no new heavy dependencies; reduced-motion honored (MotionConfig already global); responsive; do not weaken or delete any existing test; existing pages unaffected.

Proof: create tests/exec-dashboard.mts (repo style; component/derivation test consistent with login-page.mts + scoring-metrics.mts). Assert: (a) exec tile values equal the canonical metrics.ts derivations on a fixture state (no divergent local filter); (b) a fixture with a synthetic candidate + a dry-run send + a real send shows ONLY the real one in live tiles; (c) grep-style assert the page source contains no Math.random and no hardcoded metric literal; (d) open-rate tile renders the "not tracked yet" text, not a number; (e) viewer vs admin: export control present only for admin. The Visionary runs it outside the sandbox; you need `npx tsc --noEmit` clean.

Stop when: /exec page built calling canonical metrics, provenance/demo honesty in place, RBAC applied, nav entry added, tests/exec-dashboard.mts encodes (a)-(e), `npx tsc --noEmit` clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = built + tsc clean + test encodes (a)-(e); REVISE = blocked/incomplete (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
