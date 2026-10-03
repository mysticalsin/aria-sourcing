# N-agent FE↔BE wire audit — tip `211a8ee` (2026-10-03)

Scope: campaign multi-seat attach, seatId↔computerId, floor↔fleet, go-live/ops targeting, Hermes↔fleet, N>1 isolation. Skip Fly/owner deploy.

## Verdict

Physical VM isolation + fleet poll↔floor/ops computer targeting are wired fail-closed on tip.
**Campaign attach is not consistently enforced** on allocate / send-seat pick / sole-stamp / source pulses — empty `assignedCampaignIds` still acts as a shared pool for LinkedIn Browser Computer, while Setup / Go-live / Floor theater require explicit attach.

## Findings

### F1 — Campaign attach ignored when `assignedCampaignIds` empty (isolation)
| File:line | Issue | One-line fix |
|---|---|---|
| `src/lib/agent-event-seat.ts:21-22` | Empty assigned ⇒ every LI Browser desk is “on” every campaign (source pulses / sole stamp when N=1) | Require `assigned.includes(campaignId)` for LI Browser (empty ≠ attached) |
| `src/lib/store.ts:5269-5272` | `allocateOutreach` treats empty as shared pool, then falls back to **all** `activeSeats` if none match | Filter LI via explicit attach; if no attached seats, `seatPool=[]` (do not fall back to all) |
| `src/lib/linkedin-automatic.ts:72-75` | Empty LI Browser ranks as shared-pool send candidate (rank 1) | Rank empty Browser Computer ineligible (Vendor empty may stay shared) |
| `src/lib/store.ts:2610` | Approve path `soleAuto = soleBrowser ?? (liLive.length===1 ? liLive[0] : …)` stamps sole live LI regardless of campaign attach | Drop `liLive.length===1` fallback; only `soleCampaignBrowserSeatId` or block |

Contrast (correct on tip): `src/lib/floor.ts:66-77`, `src/lib/campaign-go-live.ts:137-142`, `src/components/settings/setup-guide-panel.tsx:82-86`.

Working tree WIP (`src/lib/campaign-seat-attach.ts` + partial store/linkedin/agent-event edits) starts F1 but still leaves `store.ts:5272` fallback and `:2610` soleAuto.

### F2 — seatId↔computerId mismatch in API→UI
**NONE** (high confidence). GET enrich preserves supervisor `seatId`/`computerId`; Floor/Campaign/Fleet index by seatId and refuse `__orphan__`/empty/foreign; POST mutating actions require `callerSeatId === boundSeatId`.

### F3 — 3D floor missing seats fleet has
**NONE as wiring bug** (high confidence). Device cap `MAX_3D_AGENTS` (`device.ts:36-39`, `RetroOfficeScene.tsx:61-66`) with honest “not shown” copy; `preferBrowserComputerAgents` keeps LI VMs inside cap. 2D grid shows full roster.

### F4 — Go-live / ops drive wrong computer
**NONE** (high confidence). `computerForSeat` seat-owned first; Campaign Agents `act` / Fleet `computerAction` send owning `seatId`; `bootBrowserComputer` refuses ensure seat mismatch.

### F5 — Hermes vs fleet poll divergence
**NONE** (high confidence on tip). `fleetHermesComputerPatches` on Floor/Fleet/Campaign Agents/LinkedIn Settings clears foreign/orphan/absent and writes owned binds.

### F6 — N>1 seats share one VM / lose profile isolation
**NONE for Chromium profile sharing** (high confidence). `ensureComputer` ownership mismatch; reclaim probe-before-claim + `priorSeatId`; OpenBot `PROFILE_ROOT/botId`. Logical campaign-pool bleed is F1, not shared profile dirs.

## Tip vs WIP

- Tip SHA: `211a8ee`
- Uncommitted: `campaign-seat-attach.ts` + agent-event / linkedin-automatic / store allocate filter (incomplete vs F1)
