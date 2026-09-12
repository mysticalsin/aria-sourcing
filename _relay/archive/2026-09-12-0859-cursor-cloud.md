---
project: MSourcing / ARIA
shift: 198
agent: cursor-cloud
updated: 2026-09-12T08:50Z
status: linkedin-ui-lessons-efficiency-index-llm-skip-adaptive-pace
---

# Handoff — Shift 198

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` — LinkedIn UI second-brain **efficiency index** (LLM skip + compact hints + adaptive pace)
- **Fly:** tip **not live**; `/api/ready` SHA stale; fleet `sessionHealthy:false` (CAPTCHA/login wall)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/142
- **Lessons:** scored seat×goal×control index; confident desks skip Aria LLM picks (~900 tokens/skip), shrink prompts (`ui:prefer:…`), and cut waits ~40%

## Done this shift

1. Compact scored lesson index (`linkedin-ui-lessons-index.json`) with wins/fails/avgDuration/tokensSaved
2. `shouldSkipLinkedInUiLlm` + `pickElementByLesson` — zero-token control pick when confidence ≥0.72
3. Compact `linkedInUiLessonHints` (`prefer:Connect;avoid:Message`) instead of prose
4. Adaptive `humanUiPaceMs` — faster on confident seats, slower after fails; seat-isolated
5. Aria LLM pick shrinks element dump when prefer-hints present
6. Skills API/card expose efficiency (LLM skips, tokens saved, pace multiplier, top controls)
7. Tests: 32 passed; typecheck green

## Blockers (unchanged — cannot show LinkedIn messages yet)

1. Human Take control → LinkedIn CAPTCHA/login/2FA → Release → `sessionHealthy:true`
2. Tip not on protected Fly release
3. Host cap / frameworks readiness
4. Live N-seat prove + sealed land with Messaging UI proof

## Next steps

1. Operator Take control on live computer → finish LinkedIn login → Release → probe healthy
2. Re-run marketing recorder; claim Messaging only with UI proof
3. Land tip via protected release
4. Prove N distinct computerIds + floor pulses

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Copy lessons (`outreach_skill`) stay separate from VM UI lessons (`linkedin-ui-lessons`)
- Sealed outreach copy is the only text bots type/post
- Every UI lesson must compound into fewer tokens / faster pacing — not just a log line
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` = `Twalteur@amaris.com`; ~5/min
- Index + JSON lessons both under `data/llm-wiki/`
- Seat isolation: confidence/pace do not leak across desks; hints may bootstrap from workspace when a seat is cold
