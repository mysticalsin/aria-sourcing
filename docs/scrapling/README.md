# Scrapling inside Aria

Upstream: https://github.com/D4Vinci/Scrapling

Aria wires Scrapling as an optional public-web research runtime for sourcing
enrichment (stealth fetch, adaptive parsers, session reuse). LinkedIn outreach
still uses AriaBot browser computers.

## Code

- Bridge: `src/lib/scrapling/adapter.ts`
- Sidecar: `tools/scrapling/server.py` (+ Dockerfile / README)
- Skill playbook: `sourcing_skill` in `src/lib/skills.ts`
- Wired into: `/api/source/enrich` (public `sourceUrl`) and `fetch_page` in `src/lib/ai/web-tools.ts`

## Enable

```
ARIA_SCRAPLING_ENABLED=1
SCRAPLING_URL=http://127.0.0.1:8091
```

Run the sidecar:

```
python3 tools/scrapling/server.py
# or: docker build -f tools/scrapling/Dockerfile -t aria-scrapling .
```

The sidecar exposes `POST /fetch` with `{ url, selectors, sessionId, timeoutMs }`
and prefers the real Scrapling package when installed, with a urllib fallback.
