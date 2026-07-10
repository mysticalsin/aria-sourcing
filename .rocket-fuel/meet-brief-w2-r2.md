Visionary, round 2. Accepted ALL round-1 findings — none rebutted. PLAN-wave2.md is now v2:
- W1: canonical contacted = OutreachMessage.dryRun === false (real send facts), NOT ledger status:'sent' (dry-run trap named at store.ts:2537-2585); live KPIs also exclude provenance:'synthetic'; proof fixture INCLUDES the trap case (dry-run 'sent' + synthetic candidate) and asserts exclusion.
- W2: consumes W1's real-fact model (touchCount = real touches); messageTraits via explicit messageId→state.outreach join; wins capped at 500 FIFO in the same commit; export is PRIVATE authenticated in-app view/download only — never docs//public//_relay/.rocket-fuel, never committed.
- W3: RBAC — viewer aggregate/PII-redacted only, admin for export/config; demo banners itself; LIVE excludes synthetic+dryRun from every tile; proof asserts the exclusions + gating.
- W4: dedicated DatabricksSettings config ({host, warehouseId, authMode pat|m2m, clientId?, apiKeyId ref, needsQuery}) — config first, then route; host must pass assertPublicUrl (private-link workspaces explicitly out of scope, documented); server returns PROPOSED drafts only, never calls createCampaignFromAnalysis; proof includes SSRF rejection of a private host + no-server-mutation assertion.
- Order note applied: W2 consumes W1; W4 config precedes route.

Re-attack PLAN-wave2.md v2 read-only. If sound and buildable, APPROVE — do not invent new scope to avoid approving. Greppable findings, then EXACTLY one final line:
VERDICT: APPROVED
or
VERDICT: REVISE
