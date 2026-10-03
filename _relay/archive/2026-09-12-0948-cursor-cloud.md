---
project: MSourcing / ARIA
shift: 200
agent: cursor-cloud
updated: 2026-09-12T09:10Z
status: hyper-fluid-takeover-agenticseek-grokbot
---

# Handoff — Shift 200

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` — hyper-fluid Take control / get-out (AgenticSeek watch + GrokBot jump-in)
- **Fly tip:** still on deploy SHA from shift 199 (`21a42e7…`); this shift is UX/code — redeploy Fly when ready
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/143 (update with fluid takeover)

## Done this shift

1. `src/lib/fluid-takeover.ts` — Esc/R get-out, T take, typing-safe hotkeys, `?fs=1` jump-in helper
2. OpenBot shell: watch-mode hint, click-to-take, Esc/R release, Get out · Release button
3. Fleet computers panel: embedded live iframe (AgenticSeek-style watch) + hotkeys
4. Viewport page: embed remote/live URL + same hotkeys
5. Tests: `tests/fluid-takeover.mts` registered in manifest (application 185)

## Blockers (unchanged)

1. Human Take control on live Fly → LinkedIn CAPTCHA/login → Release → `sessionHealthy:true`
2. Host cap / `agentFrameworks=false`
3. Tip not on protected `deploy/fly-github-actions`

## Next steps

1. Redeploy Fly app-only with this tip (owner `prod-deploy-app.sh`)
2. Operator: Open view → watch agent → Take control (T) → finish LinkedIn → Esc get out
3. Re-run marketing recorder with Messaging UI proof

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- AgenticSeek-style: agents keep acting while operator watches; GrokBot-style: instant take / Esc get-out
- Do not bypass protected Fly release guards
- Fly only for LinkedIn / OpenBot / computers

## Watch out

- Hotkeys ignore typing targets (omnibox / LinkedIn inputs)
- OpenBot `?fs=1` auto-takes + fullscreen on load
- Iframe embed needs COMPUTER_SUPERVISOR_URL / remoteUrl bound for live CDP
