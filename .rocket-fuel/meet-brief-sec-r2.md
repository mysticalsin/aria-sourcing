Visionary, round 2. Accepted ALL of round 1 — none rebutted. design-agent-security.md is now v2:
- Two centralized functions: toCandidatePublicRoleContext() (source minimization, DEFAULT-DENY whitelist of real JobAnalysis fields) + validateCandidateBoundText() (shared sink gate, folds in the existing COMMITMENT_PATTERNS).
- Whitelist applied at ALL model-prompt sources you named (whatsapp-inbound, agents/graph.ts brief serialization, agents/run, sourcing-agent, store.ts live outreach). Sink gate at ALL candidate-bound sinks (decideAutopilot, approve, send, whatsapp-review, dispatch, reply-classification drafts).
- Salary is ALLOWLIST-based: only "ask candidate's target" or "recruiter will discuss"; blocks inference leaks (in range/above/below/that works/a bit over/competitive within band).
- DISCLOSABLE = real types.ts JobAnalysis fields (title, seniority, requiredSkills, niceToHaveSkills, locationType, location, regions, ...); everything else default-denied.
- FORBIDDEN completed (salary/currency/equity/department/teamSize/reportingTo/urgency/validationWarnings/scoringWeights/owner_id/workspace_id/seat_id/client+recruiter names/PII...).
- detectInjection = triage SIGNAL only (human-queue flag), NOT the boundary — the whitelist is. Careers marked deterministic-no-LLM today; target-salary capture deferred with a tracked schema/UI note.
- Salary fit assessment is server-side; the candidate-facing model never receives or computes against the internal number.

Re-attack design v2 read-only. Focus:
1. Is EVERY candidate-bound model-prompt source now covered by the whitelist, or is there still a path that serializes internal fields to a candidate-facing model? Name any.
2. Is EVERY candidate-bound sink now gated, or can a leaking draft still reach a candidate un-scanned?
3. Is the salary allowlist actually leak-proof against inference, or is there a phrasing class still open?
4. Anything in v2 that makes it HARD to modify (Owner's requirement)?
If sound and buildable, APPROVE. Greppable findings then EXACTLY one final line:
VERDICT: APPROVED
or
VERDICT: REVISE
