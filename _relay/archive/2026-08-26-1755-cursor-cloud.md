---
project: MSourcing / ARIA
shift: 91
agent: cursor-cloud
updated: 2026-08-26 UTC
status: llm-providers-deepseek-nim
---

# Handoff - Shift 91

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29 · commit `ad553d9`
- Settings → AI Add-key vault now includes **DeepSeek**, **NVIDIA NIM**, and **Kimi (Moonshot)** with live verify
- LLM provider kinds + cloud routing (`deepseek`, `nvidia` slugs) wired in `provider.ts` / `key-probe.ts`
- Defaults: DeepSeek `deepseek-chat`; NVIDIA NIM `meta/llama-3.3-70b-instruct` (override via SavedModel / `NVIDIA_NIM_BASE_URL`)

## Done this shift

- Added DeepSeek + NVIDIA NIM to `API_KEY_PROVIDERS` / `LLM_PROVIDERS`
- Live probes + format (`sk-…` / `nvapi-…`); hermes chat accepts new slugs + org/model ids
- Tests: llm-key-probe 16 pass; admin-config 46 pass; tsc green

## Blockers

- Fly may still lag release identity — redeploy for live dropdown

## Next steps

1. Redeploy Fly so live Settings → AI shows DeepSeek / NVIDIA NIM / Kimi
2. Optional: screenshot Add-key provider dropdown

## Decisions made (don't relitigate)

- NVIDIA NIM cloud base `https://integrate.api.nvidia.com/v1` (override with `NVIDIA_NIM_BASE_URL` / `NIM_BASE_URL` for self-hosted)
- DeepSeek base `https://api.deepseek.com` (override `DEEPSEEK_BASE_URL`)
- Kimi stays vault label `Kimi (Moonshot)` mapped from LLM kind `Kimi`
- Do not commit secrets to `_relay/`

## Watch out

- NIM model ids use `org/model` — hermes model regex now allows `/`
- NVIDIA format expects `nvapi-…` keys from build.nvidia.com
