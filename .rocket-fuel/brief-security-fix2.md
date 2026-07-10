You are the Integrator applying a tight SECURITY FIX to the disclosure layer. workspace-write. A Visionary adversarial re-verify found ONE residual salary leak. Fix EXACTLY this.

Objective: close the possessive-range comp leak — "You are well within our range" (and the "our/the/your range|band|budget" class) currently passes validateCandidateBoundText because the compensation topic-gate lists "in our range" but not "within our range" or bare possessive range/band/budget.

Read first: (understand before editing)
- src/lib/agent-disclosure-policy.ts COMPENSATION_TOPIC_PATTERNS (~154): has /\bin (?:our|the) range\b/ but NOT "within our range" nor possessive "our range"/"the band"/"your budget". "range" is absent from the bare comp-keyword list (line ~155), so "within our range" is not detected as a comp topic → not blocked.
- mentionsCompensationTopic / isSafeCompResponse / validateCandidateBoundText — the gate. SAFE_COMP_RESPONSE_PATTERNS already lets "what range are you targeting" through, so adding a broader "range" trigger will NOT break the safe-ask path (it re-passes via isSafeCompResponse).

Build:
1. Add to COMPENSATION_TOPIC_PATTERNS a possessive-range pattern that catches "within our range", "in our range", "our range", "the range", "your range", and the same for "band" and "budget": e.g. /\b(?:with)?in\s+(?:our|the|your)\s+(?:salary\s+|pay\s+|comp\s+)?(?:range|band|budget)\b/i AND /\b(?:our|the|your)\s+(?:salary\s+|pay\s+|comp\s+)?(?:range|band|budget)\b/i.
2. Confirm this does NOT break the safe-ask path: "what range are you targeting?" and "what range are you looking for?" must still PASS (they match SAFE_COMP_RESPONSE_PATTERNS, so mentionsCompensationTopic=true + isSafeCompResponse=true → allowed). If needed, ensure SAFE_COMP_RESPONSE_PATTERNS covers "what range are you targeting/looking for" (bare "range", no "salary" prefix).

Constraints: (what must NOT change) do not weaken the topic-gate, the whitelist, any guardrail, or the safe-ask allowance. Do not delete or weaken any existing test. Preserve commitment-* reason tags.

Proof: add cases to tests/agent-disclosure-policy.mts asserting validateCandidateBoundText BLOCKS "You are well within our range", "You're in our range", "That's our band", and still PASSES "What range are you targeting?" and "What range are you looking for?". The Visionary runs `npx tsx tests/agent-disclosure-policy.mts` + `npx tsx tests/salary-boundary-adversarial.mts` (expects 14 passed, 0 failed) + `npx tsx tests/autopilot.mts` outside the sandbox; you need `npx tsc --noEmit` clean.

Stop when: the possessive-range class is blocked, the safe-ask path still passes, tests extended, `npx tsc --noEmit` clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = leak closed + safe-ask intact + tsc clean; REVISE = otherwise (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
