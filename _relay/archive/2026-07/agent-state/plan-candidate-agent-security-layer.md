# Candidate Agent Security Layer Plan

- [x] Read approved design and relevant source/sink code.
- [x] Add shared disclosure policy with whitelist, injection triage, salary inference blocklist, and tests.
- [x] Replace candidate-facing prompt leak sources with whitelisted role context.
- [x] Gate candidate-bound sinks with validateCandidateBoundText and human-queue behavior.
- [x] Run typecheck and record review/results.

## Review

- Added `src/lib/agent-disclosure-policy.ts` with default-deny role context, injection triage, salary inference blocks, and the shared candidate-bound validator.
- Replaced listed raw role/brief model inputs with `candidateDisclosureContextForCampaignLike(...)`.
- Added sink scans to autopilot, approval, send, WhatsApp review, dispatch, sourcing-agent drafts, and reply-classification draft storage.
- Added `tests/agent-disclosure-policy.mts` for whitelist drops, injection detection, salary/inference blocks, allowed salary-target ask, and drift guards.
- Proof: `npx tsc --noEmit` passed.
- Sandbox note: `npx tsx tests/agent-disclosure-policy.mts` did not execute here because `tsx` failed before test code with `listen EPERM` on its IPC pipe.
