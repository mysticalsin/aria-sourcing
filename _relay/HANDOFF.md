---
project: MSourcing / ARIA
shift: 79
agent: cursor-cloud
updated: 2026-08-26 UTC
status: recruiting-loop-e2e-including-linkedin-confirm
---

# Handoff - Shift 79

## Current state

- **Production:** https://aria-mantu-app.fly.dev · migration **0060** applied.
- Full recruiting loop proven: intake → source (LinkedIn) → approve → send refused (409) → **confirm-manual ledger**.
- Vision doc: `_relay/VISION-recruiting-loop.md` (LangChain rewrite rejected; use existing tool-loop + templates).
- LinkedIn Assisted Manual seat live (`My LinkedIn (assisted)`).
- Hermes/Kimi still 401 → template drafts (by design, not a blocker).

## Done this shift

- Documented product vision for LinkedIn contact (assisted-manual only).
- Fixed `upsert_linkedin_inbound_route` (`gen_random_bytes` missing under search_path) via **0060**.
- Connected LinkedIn seat; confirmed manual send wrote `outreach_ledger`.
- Hermes upstream failures now flag `useTemplateFallback: true`.

## Blockers

- Kimi 401 for live LLM copy (optional to fix with OpenAI/Anthropic vault key).
- Bootstrap image still needs rebuild to bake 0060 (DB already has it).
- `/api/ready` agentFrameworks false (expected).

## Next steps

1. Optional: set outreach default to Anthropic/OpenAI vault key for nicer drafts.
2. Rebuild bootstrap so 0060 is in the image ledger bake.
3. Operator UX: hard-refresh → Source → Draft LinkedIn → Approve → Copy/Open LinkedIn → Confirm.

## Decisions made (don't relitigate)

- No LangChain rewrite for Hermes; existing `tool-loop.ts` + deterministic sourcing + template drafts are the authority path.
- LinkedIn remains assisted-manual (409 on `/api/outreach/send`); Confirm writes the durable receipt.
- Experience floors (`8 years +`, etc.) → Senior for readiness.

## Watch out

- Outreach approve disclosure policy blocks drafts that leak department tokens like "Consulting" or salary figures.
- Do not commit secrets; LinkedIn route_key is sensitive-ish — do not paste into public chat.
