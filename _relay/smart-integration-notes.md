# SMART resume-DB integration notes

**Branch:** `cursor/smart-resume-integration-b91d`
**Date:** 2026-08-30

## What landed

- Pull: `POST /api/source/smart/search` + multi-provider `smart` backend
- Push: `POST /api/source/smart/writeback`
- Mapper: `src/lib/sourcing/smart-map.ts` → provenance live, platform SMART
- Contract/client: `smart-contract.ts` + `smart.ts`
- Settings: SMART card real=true, Access & Keys provider SMART

## Mock vs live

- Live: SMART_API_BASE_URL + vault/env SMART_API_KEY
- Mock: SMART_FORCE_MOCK=true
- Fail-closed without keys (no invented live hits)

## Blockers

- No real SMART OpenAPI/docs or credentials in this environment
- Confirm egress allowlist once SMART_API_BASE_URL hostname is known
