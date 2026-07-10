Visionary, round 3. Accepted all of round 2 — none rebutted. PLAN.md is now v3:
- Rock 2 chokepoint is now FULL: tavilyKey threaded through tool-loop.ts execTool + loop-runner context, resolved+passed by source route, sourcing-agent, agents/run, hermes/chat — all 6 web_search sites. No site left on env-only.
- Proof responsibility split: Rock 2 proves the SURFACE offline (fake-Supabase harness: encrypt round-trip, resolveStoredTavilyKey returns workspace key, stubbed webSearch RECEIVES the stored key via route→tool-loop when env unset, env fallback, validator, plaintext-write blocked). Rock 1 proves REAL candidates live.
- Safe storage: Rock 2(a) sets DATA_ENCRYPTION_KEY + hardens encryptionRequiredButMissing so a real-data workspace never stores a provider key in plaintext (verified currently unset → plaintext today).
- Baseline corrected: 79 test + 3 pretest = 82 unique files; gate logs cited (scratchpad/g3-*.log); dirty worktree acknowledged; Rock 7 reconciles.
- Rock 4 proof adds tests/outreach-guardrails.mts. Every rock creates its own proof file as a deliverable.

Re-attack PLAN.md v3 read-only. This should be tight now. Focus ONLY on:
1. Is the full 6-site chokepoint design actually complete, or is there STILL a web_search path that bypasses the threaded key?
2. Is any proof command still undecidable/invalid?
3. Any remaining false/stale baseline claim?
4. Does the DATA_ENCRYPTION_KEY / plaintext hardening actually close the "safe" gap, or is there a residual plaintext path?

If the plan is sound, APPROVE it — do not invent new scope to avoid approving. Same contract: greppable findings, then EXACTLY one final line:
VERDICT: APPROVED
or
VERDICT: REVISE
