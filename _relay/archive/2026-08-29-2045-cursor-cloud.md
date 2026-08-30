---
project: MSourcing / ARIA
shift: 397
agent: cursor-cloud
updated: 2026-08-29T20:45Z
status: rei-wa-linkedin-failclosed
---

# Handoff — Shift 397

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **Change:** WhatsApp cold first-touch fail-closed (open window → reply; else zero-param Meta template; else skip). LinkedIn durable-only (live HeyReach/vendor seat required — no direct REST fallback). Copy/skills honesty + draft phone 422.
- **Live Fly:** `1665b39` / **0074**; **0076 not applied**; Graph dropzones absent → **HOLD**

## Done this shift

1. `src/lib/rei-autopilot-whatsapp.ts` — resolve reply-window vs cold template shape
2. `rei-autopilot-dispatch.ts` — mint after WA shape; LinkedIn seat-required durable enqueue only
3. Migration **0076** — `enqueue_whatsapp_outbound_service` accepts `approved_template`
4. Settings copy (email connections, Sequences hint), `skills.ts` Autopilot exception
5. `generate-outreach-draft` WA/SMS missing phone → 422
6. Tests: `rei-autopilot-whatsapp`, expanded dispatch suite

## Blockers

1. Deploy tip + **0076**
2. Operator Settings HeyReach API + live HeyReach seat after deploy
3. Cold WA needs zero-param Meta template (or human template picker)
4. Graph dropzones empty — strict PASS HOLD

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
# Settings → Save HeyReach API + live HeyReach seat; entitle autopilot; arm Sequences
# Optional: approve a zero-param WhatsApp Meta template for cold first-touch
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Settings vault + campaign first-class; Fly env optional
- Autopilot fail-closed: qualityStatus=ready + criticsPassed
- WhatsApp cold: Meta approved template (zero-param auto) or human picker — never free-form without open window
- LinkedIn autopilot: durable outbox + live HeyReach/vendor seat only (no direct-send bypass)
- interview_prep_send claimable after live book
- HOLD when Microsoft dropzones empty

## Watch out

- Run dispatch tests with `--experimental-test-module-mocks`
- Client: `heyReachSettingsReady` from `heyreach-config`
- `typecheck:tests` still has pre-existing errors in sourcing-loop-worker / store-booking (unrelated)
