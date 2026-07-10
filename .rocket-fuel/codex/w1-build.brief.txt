You are the Integrator building Rock W1 of the approved Wave-2 plan (.rocket-fuel/PLAN-wave2.md, .rocket-fuel/ROCKS-wave2.md) in the MSourcing repo. workspace-write. Build EXACTLY this.

Objective: one canonical, real-send-fact KPI derivation in src/lib/metrics.ts consumed everywhere, so exec numbers can never count demo dry-runs, approved-but-unsent messages, or synthetic candidates as real contact facts.

Read first: (understand before editing)
- src/lib/metrics.ts — computeCampaignMetrics (~94-138: stage high-water contacted), globalKpis (~155-192).
- src/lib/store.ts:2537-2585 — demo dry-run approval writes local ledger status:'sent' AND OutreachMessage dryRun flag semantics; :2660-2685 manual LinkedIn confirm transition; :2813-2821 provider-send transitions (where sentAt is stamped).
- src/lib/types.ts — OutreachMessage (dryRun, sentAt ~518-540), OutreachLedgerEntry (~970: NO dryRun/messageId fields), Candidate.provenance (~332-336), CampaignMetrics (~680).
- src/components/floor/mission-control-hud.tsx:16-86 — HUD currently counts ledger status==='sent' independently.
- tests/scoring-metrics.mts — existing metrics test style.

Build:
1. In metrics.ts add the canonical predicate + derivation: isRealSendFact(message): message.dryRun === false && message.sentAt != null. Export a canonical funnel derivation (e.g. realFunnelFacts(state, {live}: {live:boolean})) computing: contacted = distinct candidateIds with a real send fact; repliedCount/positiveReplies from replies tied to those candidates; booked from bookings; in live mode exclude candidates with provenance === 'synthetic' from every count. Keep the existing stage-based numbers available where they're genuinely about pipeline stage (don't break existing consumers' semantics silently — rename/document).
2. Consume it: globalKpis and computeCampaignMetrics use the canonical derivation for contacted/replyRate/interviewsBooked; mission-control-hud.tsx uses the SAME exported derivation instead of its own ledger status==='sent' count.
3. Do not change any wire/guardrail behavior — this is measurement only.

Constraints: (what must NOT change) no UI redesign; no new dependencies; do not weaken or delete any existing test; tests/scoring-metrics.mts must still pass (update ONLY if its assertions encode the old inconsistent definition — then align them to canonical with a comment).

Proof: create tests/metrics-canonical.mts (repo test style: ok()/RESULT/exitCode). Fixture must include the THREE traps: (a) a demo dry-run message (dryRun:true) whose ledger row says status:'sent'; (b) a live approved-unsent message (dryRun:false, sentAt:null, ledger 'claimed'); (c) a candidate with provenance:'synthetic' who HAS a real send fact. Assert: none of the three count toward live contacted; a real completed send (dryRun:false, sentAt set) DOES count; globalKpis, computeCampaignMetrics, and the HUD derivation agree on the same fixture. The Visionary runs it outside the sandbox; you need `npx tsc --noEmit` clean.

Stop when: canonical predicate exported + consumed by metrics.ts and the HUD, tests/metrics-canonical.mts exists with the 3-trap fixture, and `npx tsc --noEmit` is clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = built + tsc clean + test encodes the 3 traps; REVISE = blocked/incomplete (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
