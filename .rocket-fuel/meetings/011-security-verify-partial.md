# Security 4-lens adversarial verify — findings (2 of 4 lenses, partial)
The mandatory pre-SHIP verify. It found a STRUCTURAL flaw before ship — security build → REVISE (not SHIP).

## LENS salary-inference: issues-found — BLOCKER (the headline)
- **Denylist is the wrong control class.** Permitted set is tiny+closed (ask candidate's target OR defer to recruiter); forbidden set is unbounded. Denylist can never be complete.
- Concrete leaks that pass the current regex: "in our range"/"within our range" (only "in range" caught); "over/under our budget" (only above/below/outside/out-of); positional — "top of what we do", "the ceiling", "upper end"; French — "dans la fourchette" (English-only); "that's workable/doable/fine on our end"; proximity — "same ballpark", "not far apart", "a bit of a gap"; softened — "on the high side", "a bit high", "steep", "rich for us"; formatting evasions — "in-range" (hyphen), "too  high" (double space); number-words/shorthand not in salaryVariants.
- FIX (allowlist/topic-gate): detect the COMPENSATION TOPIC in a candidate-facing draft (mentions pay/salary/comp/range/budget/rate/currency symbol/number-near-money, multi-language stems). If the draft touches comp AND is not one of the two safe moves (asking the candidate's target / deferring to a recruiter), BLOCK → human queue. Bounded topic-detect + tiny allowlist replaces the unbounded denylist.

## LENS injection-bypass: issues-found
- major: detectInjection is enforced as a HARD BLOCK on the outbound reply body at dispatch/approve — but design says it's a TRIAGE SIGNAL (flag → human queue), the WHITELIST is the boundary. A shallow English denylist as a hard gate both over-blocks legit text and under-blocks real injections. FIX: detectInjection → queue-flag only; never the sole hard gate on outbound.
- major: delimiter injection — candidate raw inbound is interpolated between <<<CANDIDATE_REPLY ... >>> sentinels with no escaping; a candidate can emit the closing sentinel to break out. FIX: strip/neutralize the sentinel tokens from candidate input before interpolation.
- minor: injection check applied inconsistently — whatsapp checks INBOUND, store checks the DRAFT. FIX: consistent (check inbound for the flag; scan every outbound draft with validateCandidateBoundText).
- minor (reassuring): "model never receives internal salary" holds IF operator/intake field hygiene is clean — disclosable free-text fields are emitted verbatim; a salary accidentally typed into a title/skills field would pass. FIX: light salary-number scrub on the emitted disclosable free-text too (defense in depth).

## Pending: lenses leak-completeness + correctness-modify (2/4). Consolidated fix pass after all 4.
Verdict so far: security build = REVISE. Do NOT SHIP until the allowlist salary control + injection-as-flag fixes land and re-verify is clean.
