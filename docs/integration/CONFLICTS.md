# Integration conflict resolutions

Branch `integration/aria-all` was created from `twa-odoo` at `e3fa3f594a6d86aec31d42a65414a96be4c8400e`.
Merges are `--no-ff` and are not squashes. Product behavior was not rewritten except where two
heads cannot both be true. Each row is one resolution.

| File | #168 / ours | Incoming | Choice | Why |
|---|---|---|---|---|
| `src/app/api/linkedin/bridge/poll/route.ts` | Deleted | #167 returns 410 and still imports the deleted bridge server | Keep deleted | #168 lands first to delete the bridge. The 410 file does not compile without `src/lib/linkedin-bridge/server.ts`. |
| `src/app/api/linkedin/outbox/route.ts` | Deleted | #167 returns 410 and still imports the bridge server | Keep deleted | Same as the poll route. |
| `tests/linkedin-bridge.mts` | Deleted | #167 and later #177 modify it | Keep deleted | The bridge suite covered a removed surface. #177's card behavior is covered by the quick-stat tests that did merge. |
| `src/lib/linkedin-channel.ts` | Functions return null. No `vendorApiAdapter` | #167 keeps refusing adapters and `LINKEDIN_VENDOR_API_` | Keep #168 | `tests/compliance-boundaries.mts` forbids the vendor adapter. Delivery stays refused. |
| `src/lib/dispatch-outbound.ts` | Early `linkedin-channel-refused` | #167 also refuses `linkedin_token` with `linkedin-delivery-refused` | Both refusals, before any claim | LinkedIn stays refused with #168's reason. `linkedin_token` stays refused with #167's reason. The duplicate later check was unreachable and was dropped. |
| `docker-compose.yml` agents service | Deleted, including `AGENT_RUNNER_SECRET` | #167, #170, #169, #171, #176, #175, #178, #174, #172, #177 re-add `agents` with `process.kill(1,0)` or `process.exit(0)` | No agents service | #168 withdraws ADR 0002. One healthcheck remains: the app's HTTP ready probe. The temporary agents probe is not reintroduced. |
| `scripts/accept-local-demo.mjs` | Several locators (id suffix, visible label, tabpanel) | Each later PR picks one Name locator | One locator: the visible Manual tabpanel's Name and Lawful basis, after the Manual tab is selected | The hidden LinkedIn panel must not win. Later PRs agreed there is a single visible field. |
| `.github/workflows/ci.yml` secret scan | #168 scans `HEAD` | #167 scans `--all` and checks ignore commits are reachable | #167 `--all` plus the reachability check | `tests/approval-devin-gate.mts` requires `--all`. |
| `.github/workflows/ci.yml` release gate | #175 adds `channel-adapters` | #178 adds `linkedin-token-e2e` | Both jobs, and the gate needs both | Each PR added a check the other does not replace. |
| `.gitleaksignore` | Per-fingerprint comments, including `linkedinPublicId` / `not a credential` | Later PRs rewrite the same fingerprints' comments | Keep the per-line comments already on the branch | `tests/approval-sentinel.mts` requires that comment. Fingerprint sets were equal at each conflict; no new fingerprint was dropped. |
| `supabase/migrations/0010_exact_approval_timestamp.sql` and `0011_exact_body_hash.sql` | #168 already owns `0010_drop_linkedin_bridge.sql` and `0011_drop_agent_autopilot.sql` | #167 adds a second 0010 and 0011 | Renamed to `0012_exact_approval_timestamp.sql` and `0013_exact_body_hash.sql` | Supabase rejects two files with the same version. Drops stay 0010 and 0011 and run first. |
| `tests/approval-sentinel.mts` and `tests/approval-devin-gate.mts` | Not a git conflict by themselves | They read the 410 routes and `getLinkedInAdapter`, and the agents `process.kill` probe | Assert the routes and the agents service are absent, and that dispatch still refuses LinkedIn | Those tests described #167's temporary state. #167's own text says #168 deletes the routes and the probe. |
| `tests/test-manifest.mjs` | Bridge and autopilot commands removed | #178 re-lists `linkedin-bridge`, `linkedin-token`, and `agents-autopilot` | Keep `linkedin-token` only | The other two files are deleted. Registering them would point the runner at missing tests. |
| `src/app/outreach/page.tsx` bulk approve | `actions.approveOutreach` | #172 calls `approvalCommands.approveOutreach` and then `deliverOnLinkedIn` | Feature-module approve, no LinkedIn delivery | #172's command object is what the page imports. The bridge delivery function is gone. |
| `src/app/settings/page.tsx` | Store hooks and a plain section | #172 imports the deleted `LinkedInSettingsPanel` and renames the section | `useSettingsDesk` hooks and `SettingsSection`, no bridge panel | The panel file was deleted. The rest of the page already uses `SettingsSection`. |
| `src/app/funnel/page.tsx` | #172 `usePipelineBoard` | #177 processing board and stage cards | Both: board data from `usePipelineBoard`, presentation from #177 | The processing UI needs the candidate list. The feature hook is that list. |
| `src/components/outreach/outreach-message-card.tsx` | Early return toast that nothing was sent | #177 exact-text toast that also says nothing was sent for LinkedIn | #177's single toast | One approval message. It still does not send. |
| `_relay/HANDOFF.md` | Rewritten by several PRs | Each PR replaces the baton | Integration baton, decisions from #168 and #167 kept | The file is the shift log, not product behavior. Archives already merged were kept. |

#173 was not merged.
