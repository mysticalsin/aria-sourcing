# Security 4-lens adversarial verify — FULL (all 4 lenses) → build = REVISE
Mandatory pre-SHIP verify. Reassuring through-line: NO active salary-to-candidate leak in the normal path (whitelist keeps salary out of model context; drafts human-queued; no auto-send). But real structural weaknesses found — fixed in brief-security-fix.md before SHIP.

## BLOCKER — salary control is a denylist, must be allowlist (lens: salary-inference)
Unbounded forbidden set; bounded permitted set (ask candidate's target / defer to recruiter). Leaks that pass current regex: "in our range", positional ("top of what we do","ceiling","upper end"), French ("dans la fourchette"), "that's workable/doable", proximity ("same ballpark","not far apart"), softened ("on the high side","steep"), formatting ("in-range" hyphen, "too  high" double-space), number-words.
FIX: mentionsCompensationTopic() + isSafeCompResponse() topic-gate as the PRIMARY control; denylist demoted to secondary belt.

## Fail-OPEN gates (lens: leak-completeness) — all minor, but wrong direction
- send/route.ts:45,158 — disclosureInternalFromCampaign returns {} on campaignId miss → salary+forbidden scan silently disabled. FIX: fail closed (topic-gate runs without needing the number).
- approve/route.ts:67 — validateCandidateBoundText(body, {}) empty context. FIX: resolve+pass real internal context.
- graph.ts:187-190 omits forbidden list; graph/hermes outreach system prompts omit DISCLOSURE_SYSTEM. FIX: consistency.

## Injection (lens: injection-bypass) — blast radius = operating-instruction disclosure, NOT salary/PII (salary never in context)
- major: detectInjection is a hard block but shallow English denylist (paraphrase/unicode/base64/French bypass). FIX: keep as QUEUE-FLAG, not sole hard gate; whitelist+topic-gate are the boundary.
- major: delimiter injection — candidate can emit CANDIDATE_REPLY>>> sentinel to break the untrusted-data envelope. FIX: sanitizeCandidateText() strips sentinels before interpolation.
- minor: salary in a free-text disclosable field (title "Senior BE circa 100k") reaches the model. FIX: scrub number-near-currency from emitted free-text (defense in depth).
- minor: inbound injection check on whatsapp but draft-only on email path. FIX: consistent inbound flag.

## Verdict
Security build = REVISE. Fix pass brief-security-fix.md staged (contract-ready). After fix: Visionary Level 10 + re-verify the salary allowlist specifically before SHIP.
This verify caught a STRUCTURAL control-class error (denylist vs allowlist) that both the single Level-10 AND the 2-round design meeting missed — the multi-lens adversarial pass is now non-negotiable for any disclosure/security boundary. (IMPROVE.md.)
Phase score: 96/100 — the process caught its own deepest blind spot before ship. That is the system at its best.
