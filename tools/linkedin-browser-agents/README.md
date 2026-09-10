# Aria LinkedIn + browser-agent sidecar

Unified local/dev sidecar for the adapters in
`src/lib/integrations/linkedin-browser-agents.ts`.

Upstream references (not vendored):

- [NightTrek/Linkedin_Agent_Tool](https://github.com/NightTrek/Linkedin_Agent_Tool)
- [DimiMikadze/orca](https://github.com/DimiMikadze/orca)
- [browser-use/browser-use](https://github.com/browser-use/browser-use)
- [KennyWayn3/crewai-browser-automation-skills-pack](https://github.com/KennyWayn3/crewai-browser-automation-skills-pack)
- [moaljumaa/linki](https://github.com/moaljumaa/linki)
- [eracle/OpenOutreach](https://github.com/eracle/OpenOutreach)

## Run

```bash
python3 tools/linkedin-browser-agents/server.py
# listens on :8092
```

Point Aria at it (fail-closed until enabled):

```bash
export ARIA_ORCA_ENABLED=1 ARIA_ORCA_URL=http://127.0.0.1:8092
export ARIA_LINKEDIN_AGENT_TOOL_ENABLED=1 ARIA_LINKEDIN_AGENT_TOOL_URL=http://127.0.0.1:8092
export ARIA_BROWSER_USE_ENABLED=1 ARIA_BROWSER_USE_URL=http://127.0.0.1:8092
export ARIA_LINKI_ENABLED=1 ARIA_LINKI_URL=http://127.0.0.1:8092
# or ARIA_OPENOUTREACH_ENABLED=1 ARIA_OPENOUTREACH_URL=http://127.0.0.1:8092
```

## Hard rule

LinkedIn **Connect / Message** stays on **AriaBot computers**. `/act` rejects
`connect` / `message` and only stubs `navigate` for public research.
