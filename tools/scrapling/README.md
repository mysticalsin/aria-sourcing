# Scrapling sidecar for Aria

Upstream: https://github.com/D4Vinci/Scrapling

This folder hosts a small HTTP sidecar that Aria's TypeScript adapter calls for
**public-web research** (sourcing enrichment). LinkedIn Connect/Message still
runs on AriaBot computers — Scrapling never replaces Take control.

## Contract

```
POST /fetch
{ "url": "https://example.com", "selectors": ["h1"], "sessionId": "opt", "timeoutMs": 20000 }

→ { "title": "...", "text": "...", "extracted": { ... }, "via": "scrapling" | "urllib-fallback" }
```

```
GET /health → { ok, scraplingInstalled, sessions }
```

## Run locally

```bash
# optional full stealth stack
pip install -r tools/scrapling/requirements.txt

python3 tools/scrapling/server.py
# listens on :8091 by default
```

```bash
export ARIA_SCRAPLING_ENABLED=1
export SCRAPLING_URL=http://127.0.0.1:8091
```

## Docker

```bash
docker build -f tools/scrapling/Dockerfile -t aria-scrapling .
docker run --rm -p 8091:8091 aria-scrapling
```

## Aria wiring

- Adapter: `src/lib/scrapling/adapter.ts`
- Enrich: `/api/source/enrich` attaches Scrapling notes for public `sourceUrl`s
- Agent tool: `fetch_page` in `src/lib/ai/web-tools.ts` prefers Scrapling when enabled
- Skill playbook: `sourcing_skill` references Scrapling for public-web research
