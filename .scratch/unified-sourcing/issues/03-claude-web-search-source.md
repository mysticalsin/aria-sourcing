# LinkedIn via Claude web search
Status: ready-for-human
Type: task

Owner request 2026-11-03: no paid Apify allowance for now; find LinkedIn
profiles with the Anthropic key instead. Stealth browser scraping (headless
Chrome posing as a user, bot-detection evasion) was declined: LinkedIn terms,
CNIL precedent (Kaspr, 2024) and account bans. This source uses only what a
search engine already indexes.

## Implemented

- Source `WebSearch` in the reviewed plan, between LinkedIn (Apify) and GitHub
  (`unified-contract.ts`; migration 0005 allows 3 steps per run).
- `src/lib/sourcing/claude-web-search.ts`: one Messages API call with
  `web_search_20250305`, `allowed_domains: ["linkedin.com/in"]`,
  `max_uses` 2-5 by limit, paused turns resumed (at most 3 requests).
  Leads come from `web_search_result` blocks only, canonical
  `https://www.linkedin.com/in/<slug>`; cited text becomes the snippet; cited
  results rank first. Each query Claude ran is checked with the LinkedIn
  sourcing policy and its results are dropped when it fails.
- Egress through `sourcingFetch` (`Anthropic: api.anthropic.com`), clearance
  `clearWebSearchDiscovery`.
- Key: the workspace vault Anthropic key linked on the enabled Anthropic
  provider, never the server env key. Model: the sourcing default if it is
  Anthropic, else Sonnet. AI budget checked at launch and before the call.
- Spend recorded as activity `web-sourcing`; `estimateCostUsd` adds $0.01 per
  `server_tool_use.web_search_requests`.
- Run semantics: quota receipt `ClaudeWebSearch`, an interrupted start becomes
  `uncertain` and is never repeated, failure settles the receipt as failed.
- Tests: `tests/claude-web-search.mts`, route refusal without a key.

## Remaining acceptance (owner)

1. Apply migration 0005 (next `docker compose up --build`).
2. Link the Anthropic key on the Anthropic provider (Settings → AI & Models).
3. On a campaign in Sourcing, select only "LinkedIn via web search", limit 5,
   run once. Check: profiles have a linkedin.com/in link, name and headline
   match the page, AI costs shows "Web search sourcing" (~$0.02-0.10).
4. If Anthropic refuses: web search may be disabled in Claude Console →
   Settings → Capabilities.
