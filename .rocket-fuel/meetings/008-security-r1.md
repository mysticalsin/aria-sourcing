# Security Same Page Meeting — Round 1 receipt
Method: co-founder (V: claude · I: codex gpt-5.5) · fresh read-only thread · Verdict: **REVISE**
A genuinely strong security review — my design was directionally right (whitelist + layers) but under-scoped.

| Finding | Sev | IDS resolution |
|---|---|---|
| Leak scan only at WhatsApp compose; candidate-bound SINKS (approve/send/whatsapp-review/dispatch) only call gateOutbound | blocker | ACCEPTED. validateCandidateBoundText becomes a SHARED exported gate called at every sink, like gateOutbound. |
| Other full-brief leaks: agents/run→graph.ts JSON.stringify(state.brief) (:121,172-175), sourcing-agent (:57-71), live outreach store.ts (:2095-2111, 2336-2350) | blocker | ACCEPTED. toCandidatePublicRoleContext(brief) whitelist projection applied at ALL these model-prompt sources, not just whatsapp-inbound:200. |
| Salary fit split only partial: careers has no target-salary field/UI and is DETERMINISTIC (no LLM today) | blocker | ACCEPTED. WhatsApp: extract salary server-side, withhold from prompt, store as internal-only assessment. Careers: mark "already deterministic, no LLM — no leak surface today"; a target-salary capture is a separate schema/UI item (deferred, noted). |
| detectInjection regex = triage signal, trivially bypassed (unicode/base64/multi-turn/lang-switch) | risk | ACCEPTED. Reframe: the WHITELIST is the security boundary (no internal data reaches the model); detectInjection is only a queue-flag signal + candidate text delimited as untrusted. Never claim regex coverage as proof. |
| scanOutbound misses INFERENCE leaks ("that range works", "you're above budget", "a bit over 100") | risk | ACCEPTED — the sharpest one. Salary copy becomes ALLOWLIST-based: candidate-facing comp responses limited to {ask candidate's target range, "a recruiter can discuss compensation"}. NO in-range/above/below/fits-budget phrasing ever. |
| DISCLOSABLE_FIELDS don't match real JobAnalysis (requiredSkills/niceToHaveSkills/locationType/regions/employmentType, not techStack/responsibilities/workModel) | risk | ACCEPTED. Use the ACTUAL types.ts:165-195 fields. |
| FORBIDDEN incomplete | risk | ACCEPTED. Add currency, equity, validationWarnings, urgency, expectedStartDate, department(if client-id), hiringManagerEmail, reportingTo, teamSize, sourcingStrategy, scoringWeights, metrics, owner_id, workspace_id, seat_id, flowise_chatflow_id, recruiter/client names, margin/bill/pay/rate, candidate PII. (Whitelist default-denies these anyway; list is for the output scan.) |
| reply classification sends candidate text to a model (store.ts:2970-3004); its draftResponse can enter the reply workflow | risk | ACCEPTED. validateCandidateBoundText covers classifier drafts before approval/send too. |
| COMMITMENT_PATTERNS is private; "extend the gate" gets messy | nit | ACCEPTED. Export a shared disclosure scan used by decideAutopilot + approve + send + whatsapp-review. |
| Centralize TWO things (source minimization + sink validation) or the next channel drifts | nit | ACCEPTED — this is the architecture of v2. |

No findings rebutted. Verdict trend: REVISE. Design v2 written; round 2 next.
Phase score: 88/100 — my design closed one leak and put the scan at compose not the sinks; the review found 3 more leak sources + the inference-leak class. This is exactly why security gets the meeting. Improvement: security designs enumerate EVERY model-prompt source and EVERY candidate-bound sink up front (added to IMPROVE.md).
