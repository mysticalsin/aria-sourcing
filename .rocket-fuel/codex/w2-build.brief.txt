You are the Integrator building Rock W2 of the approved Wave-2 plan (.rocket-fuel/PLAN-wave2.md, ROCKS-wave2.md) in the MSourcing repo. workspace-write. Rock W1 (canonical real-send KPI derivation in metrics.ts) just shipped — consume it, don't reinvent it.

Objective: every accepted meeting becomes a structured, learnable WinRecord — appended atomically at the single booking choke point, bounded, private, feeding the learning layer — plus a private in-app winlog view/export.

Read first: (understand before editing)
- src/lib/store.ts:3399-3500 createBookingFor — THE single seam (all booking call paths flow through its commit at ~3471-3496; candidate, campaign, booking, replies, outreach history, full HermesState in scope).
- src/lib/metrics.ts — Rock W1's new canonical real-send predicate/derivation (isRealSendFact / realFunnelFacts or equivalent just added). touchCount MUST count only real completed sends per that predicate.
- src/lib/types.ts — HermesState (~1253), OutreachHistoryEntry (~245-251: messageId, channel, at), Candidate (provenance ~332), Booking (~579). Add WinRecord type + wins: WinRecord[] on HermesState.
- src/lib/skills.ts:182-251 learnedParamsFor — the real learning layer; wins should feed it as structured signals.
- src/lib/mock-ai.ts:1440 weekly-report "winning patterns" — illustrative strings; do NOT reuse as truth.
- Existing page/component patterns for a small private view (e.g. src/app/replay/page.tsx read-only derivation style).

Build:
1. types.ts: WinRecord {id, at, candidateId, candidateName, campaignId, campaignTitle, bookingId, sourcePlatform, leadSource, matchScore, seniority, roleTitle, outreachChannel (winning = last real send's channel), touchCount (real completed sends only, per W1 predicate), timeToBookMs (booking.createdAt − earliest real send at), triggeringReplyIntent (newest reply for candidate: intent+confidence), messageTraits {subjectLength?, bodyLength?, tone?} via candidate.outreachHistory[].messageId → state.outreach join}. wins: WinRecord[] on HermesState (default []).
2. store.ts createBookingFor: inside the SAME commit that flips the stage, append the WinRecord and FIFO-trim to 500 newest. Never throw from win derivation (a derivation failure must not block a booking — fall back to a minimal record).
3. skills.ts: learnedParamsFor consumes wins (e.g. channel/tone win-rates as structured signals) — additive, no behavior change when wins is empty.
4. Private winlog surface: a read-only, authenticated in-app view (route/page consistent with the app, e.g. /winlog or a wins section) rendering wins + a client-side markdown download ("winlog.md") generated on demand. PII stays inside the app: no file writes to docs/, public/, _relay/, .rocket-fuel/, no server filesystem writes.
5. Seed/demo: seed state gets wins: [] (or a couple of clearly-synthetic demo wins ONLY if existing seed patterns demand it — provenance-safe either way).

Constraints: (what must NOT change) booking behavior/flow unchanged (the commit only gains the append); no new dependencies; do not weaken or delete any existing test; metrics-canonical + scoring-metrics must still pass; store.ts persistence shape stays backward-compatible (older saved states without wins must hydrate cleanly — default []).

Proof: create tests/winlog.mts (repo style). Fixture: candidate with outreachHistory containing BOTH a dry-run touch AND real completed sends (dryRun:false, sentAt set), a reply, then drive createBookingFor (or its extracted pure derivation) and assert: win appended; touchCount counts ONLY real sends; winningChannel = last real send channel; timeToBookMs correct; cap 500 enforced (drive 501, oldest trimmed); hydration of a state WITHOUT wins defaults to []. The Visionary runs it outside the sandbox; you need `npx tsc --noEmit` clean.

Stop when: WinRecord + wins wired at the seam, learning feed added, private view/export in place, tests/winlog.mts encodes the above, `npx tsc --noEmit` clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = built + tsc clean + test encodes the assertions; REVISE = blocked/incomplete (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
