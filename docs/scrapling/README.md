# Scrapling inside Aria

Upstream: https://github.com/D4Vinci/Scrapling

Aria wires Scrapling as an optional public-web research runtime for sourcing
enrichment (stealth fetch, adaptive parsers, session reuse). LinkedIn outreach
still uses AriaBot browser computers.

## Code

- Bridge: `src/lib/scrapling/adapter.ts`
- Skill playbook: `sourcing_skill` in `src/lib/skills.ts`

## Enable

```
ARIA_SCRAPLING_ENABLED=1
SCRAPLING_URL=https://<scrapling-sidecar>/ 
```

The sidecar should expose `POST /fetch` with `{ url, selectors, sessionId, timeoutMs }`.
