# Aria LinkedIn + browser-agent integrations

Thin, fail-closed adapters live in `src/lib/integrations/linkedin-browser-agents.ts`.
They are referenced from **Agent Skills** (`sourcing_skill`) and wired into:

- `/api/source/enrich` — Orca-style profile insight + Linki/OpenOutreach ICP scoring
- LinkedIn sourcing fan-out — NightTrek-style `linkedin_agent_tool` provider when enabled
- Optional browser-use navigate sidecar (never Connect/Message)

| Capability | Upstream | Env flags |
|---|---|---|
| Profile analysis | [orca](https://github.com/DimiMikadze/orca) | `ARIA_ORCA_ENABLED`, `ARIA_ORCA_URL` (local slug heuristic always on) |
| LinkedIn search metadata | [Linkedin_Agent_Tool](https://github.com/NightTrek/Linkedin_Agent_Tool) | `ARIA_LINKEDIN_AGENT_TOOL_ENABLED`, `ARIA_LINKEDIN_AGENT_TOOL_URL` |
| Browser actions | [browser-use](https://github.com/browser-use/browser-use) (+ [CrewAI skills pack](https://github.com/KennyWayn3/crewai-browser-automation-skills-pack)) | `ARIA_BROWSER_USE_ENABLED`, `ARIA_BROWSER_USE_URL` |
| ICP qualify / SDR | [linki](https://github.com/moaljumaa/linki), [OpenOutreach](https://github.com/eracle/OpenOutreach) | `ARIA_LINKI_*` / `ARIA_OPENOUTREACH_*` |
| Public web research | [Scrapling](https://github.com/D4Vinci/Scrapling) | `ARIA_SCRAPLING_*` |

## Local sidecar

`tools/linkedin-browser-agents/server.py` implements all adapter HTTP contracts
on one port so you can enable the stack without five separate services.

```bash
python3 tools/linkedin-browser-agents/server.py
```

## Hard rule

LinkedIn **Connect / Message** in production still runs on **AriaBot computers**
(OpenBot Chromium). browser-use sidecars are optional and never replace the
seat + human Take-control path. Outreach copy always passes the **Humanizer**
(no em/en dashes as AI tells) via `outreach_skill` + `humanizeText`.
