# N-agent FE↔BE wire audit — tip through `0771ad8` / audit commit (2026-10-03)

Scope: campaign multi-seat attach, seatId↔computerId, floor↔fleet, go-live/ops targeting, Hermes↔fleet, N>1 isolation. Skip Fly/owner deploy.

## Verdict

Physical VM isolation + fleet poll↔floor/ops computer targeting are wired fail-closed.
`0771ad8` closed empty≠attach for source pulses / send-seat pick / allocate **filter**.
**Still open:** allocate fallback to all seats when none attached, and approve `liLive.length===1` soleAuto bypass.

## Findings

### F1 — Remaining campaign-attach holes (after `0771ad8`)
| File:line | Issue | One-line fix |
|---|---|---|
| `src/lib/store.ts:5272` | `seatPool = campaignSeats.length > 0 ? campaignSeats : activeSeats` — no attach ⇒ drafts on every active desk (incl. LI Browser) | If `opts.campaignId` and `campaignSeats` empty, use `[]` (fail closed), never fall back to all |
| `src/lib/store.ts:2610` | `soleAuto = soleBrowser ?? (liLive.length===1 ? liLive[0].id : …)` stamps sole live LI with no campaign attach | Drop `liLive.length===1` fallback; only `soleCampaignBrowserSeatId` or block |

Fixed in `0771ad8` (not re-open): `agent-event-seat.ts` + `linkedin-automatic.ts` + allocate filter via `seatAttachedToCampaign` / `campaign-seat-attach.ts`.

### F2 — seatId↔computerId mismatch in API→UI
**NONE** (high confidence). GET enrich preserves supervisor `seatId`/`computerId`; Floor/Campaign/Fleet index by seatId and refuse `__orphan__`/empty/foreign; POST mutating actions require `callerSeatId === boundSeatId`.

### F3 — 3D floor missing seats fleet has
**NONE as wiring bug** (high confidence). Device cap `MAX_3D_AGENTS` (`device.ts:36-39`, `RetroOfficeScene.tsx:61-66`) with honest “not shown” copy; `preferBrowserComputerAgents` keeps LI VMs inside cap. 2D grid shows full roster.

### F4 — Go-live / ops drive wrong computer
**NONE** (high confidence). `computerForSeat` seat-owned first; Campaign Agents `act` / Fleet `computerAction` send owning `seatId`; `bootBrowserComputer` refuses ensure seat mismatch.

### F5 — Hermes vs fleet poll divergence
**NONE** (high confidence). `fleetHermesComputerPatches` on Floor/Fleet/Campaign Agents/LinkedIn Settings clears foreign/orphan/absent and writes owned binds.

### F6 — N>1 seats share one VM / lose profile isolation
**NONE for Chromium profile sharing** (high confidence). `ensureComputer` ownership mismatch; reclaim probe-before-claim + `priorSeatId`; OpenBot `PROFILE_ROOT/botId`. Remaining logical bleed is F1 fallbacks only.
