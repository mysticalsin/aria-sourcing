# Aria browser computers (Browserbase-class live view)

AriaBot computers aim for the same operator feel as:

- [Browserbase](https://www.browserbase.com/) — sessions, live view, headed/headless
- [Hyperbrowser](https://www.hyperbrowser.ai/) — agent-oriented session management
- [Browserless](https://www.browserless.io/) — self-hostable browser API
- [Steel](https://steel.dev/) — open-source browser API for agents
- [Anchor Browser](https://anchorbrowser.io/) — agent workflow browsers

## What ships on Fly (`aria-mantu-computers`)

| Capability | Implementation |
|---|---|
| Live view | Binary CDP screencast over WebSocket (`/c/:id/stream`) |
| Human input | Same WS (click / move / scroll / type / key / navigate) + HTTP fallback |
| Omnibox | Navigate from the live chrome like Browserbase Debugger |
| Multitab | Tab strip, +Tab, keyboard shortcuts |
| Sessions API | `POST /sessions` → `{ sessionId, connectUrl, viewUrl }` |
| Persistence | Playwright persistent profiles on `openbot_profiles` volume |
| Stealth hooks | `navigator.webdriver` soften, locale/timezone, viewport jitter (`OPENBOT_STEALTH`) |
| Proxy | `OPENBOT_PROXY_SERVER` (+ optional username/password) |

## Public-web research (not LinkedIn send)

[Scrapling](https://github.com/D4Vinci/Scrapling) is Aria's optional stealth fetch
runtime for **public** pages. LinkedIn Connect/Message stays on AriaBot computers.

See `docs/scrapling/README.md` and `tools/scrapling/`.

## Agent toolkit bridges

LinkedIn research / ICP sidecars (Orca, NightTrek LinkedIn agent tool, browser-use,
Linki, OpenOutreach) are documented in `docs/integrations/linkedin-browser-agents.md`.
Public-web stealth fetch uses [Scrapling](https://github.com/D4Vinci/Scrapling).
