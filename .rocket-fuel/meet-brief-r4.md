Visionary, round 4. Accepted all of round 3 — none rebutted. PLAN.md is now v4:
- Blocker fixed: gate proof is now committed at .rocket-fuel/gate-proof.txt (test -f it; shows tsc PASS + 82 suites) — no more scratchpad citation.
- 7th reach-point fixed: makeSourcingToolRunner (sourcing-tools.ts, the server.run dispatched before the BUILTIN_WEB branch) gets a tavilyKey param beside githubToken; Rock 2 proof asserts the stored key flows through BOTH the source-route and sourcing-tools paths.
- Safe storage clarified: setting DATA_ENCRYPTION_KEY fixes ALL encryptSecret callers (provider keys + OAuth tokens); predicate hardened to any real-data workspace, not just prod.
- Header fixed to v4. Rock 1 gained a quality bar from the live smoke I already ran (loop is real but returned orgs, not people — so parser must extract location + query must use type:user).

Re-attack PLAN.md v4 read-only. Verify:
1. `test -f .rocket-fuel/gate-proof.txt` now passes.
2. Is the chokepoint FINALLY complete — every path that reaches runWebTool now threads the key (execTool BUILTIN_WEB branch, makeSourcingToolRunner, direct source-route call)? Name any remaining bypass or say none.
3. Any proof command still undecidable/invalid, any remaining false baseline claim.

If the plan is sound and buildable, APPROVE — do not invent new scope to avoid approving; a plan need not pre-solve every implementation detail, only be correct, decidable, and complete in scope. Same contract: greppable findings, then EXACTLY one final line:
VERDICT: APPROVED
or
VERDICT: REVISE
