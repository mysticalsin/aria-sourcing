---
project: MSourcing / ARIA
shift: 142
agent: cursor-cloud
updated: 2026-09-11T00:58Z
status: openbot-click-accuracy-fixed-deployed
---

# Handoff — Shift 142

## Current state

- **Branch:** `cursor/ariabot-vm-fluid-multitab-b91d`
- **Commit:** `d911b81` — Take control click mapping scales JPEG→device DIPs
- **Deployed:** `aria-mantu-computers` Fly machine healthy; `OPENBOT_STREAM_MAX_WIDTH=1400`
- **Prior PR #99:** closed; recreate/open new PR for this branch vs `integration/sourcing-enrichment-on-main`

## Done this shift

1. Root-caused offset clicks: stream JPEG often 1280×800 while CDP expects ~1400×900 CSS pixels; `mapPoint` used bitmap size as device size
2. Added `scripts/lib/openbot-view-coords.mjs` + unit test; live view injects same mapper
3. Keep tabs + omnibox usable in Take control (no near-invisible chrome); canvas `object-fit:contain` fills stage
4. Raised Fly stream max to 1400×900; redeployed computers app
5. “Open full sandbox” links append `?fs=1`

## Blockers

1. Operator still needs to Take control and complete LinkedIn login/captcha on the seat (session was on authwall)
2. App deploy (`aria-mantu-app`) not required for mouse fix — computers supervisor already live

## Next steps

1. Operator: Take control → verify cursor hits the same UI point → finish LinkedIn login → Release
2. Open/refresh PR for this branch against `integration/sourcing-enrichment-on-main`
3. Re-run Tony Walteur Connect E2E after session persists

## Decisions (don't relitigate)

- Click targets = CDP `deviceWidth/Height` (CSS DIPs); display = screencast bitmap pixels
- Connect/Message stays AriaBot Take control only
- Never invent LinkedIn profile URLs

## Watch out

- Dockerfile.computers must COPY `scripts/lib/openbot-view-coords.mjs`
- Do not re-lower stream max without keeping the bitmap→device scale
- Never commit Fly secrets / demo passwords / Tavily keys
