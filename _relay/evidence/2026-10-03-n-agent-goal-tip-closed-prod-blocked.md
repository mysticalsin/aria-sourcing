# N-agent goal completion audit — tip closed / production blocked

**Tip:** `cursor/linkedin-human-claude-chrome-b91d` @ `ca8cf40` (CI+CodeQL green)  
**Fly probe:** `21a42e7…` / migration `0084` / `agentFrameworks:false` (HTTP 503)  
**Deploy divergence:** tip≠deploy ancestry (657 ahead / 2 behind `f5868fa`)  
**Residual hunt:** NONE (`bc-930dd13f`)  
**Verdict:** tip N-agent class **complete** + tip CI green / production **incomplete** — **do not UpdateGoal complete**

## Goal requirements vs evidence

| Requirement | Tip | Production |
|---|---|---|
| N campaign agents real (1 seat = 1 VM/LI) | attach gates; BC empty ≠ attached; Vendor empty = shared; migrations 0085–0087 on tip | Fly still 0084; agentFrameworks false |
| Isolated LinkedIn profiles | refuseUnattached + LI login campaignId when attached | Unproven on stale build |
| Visible on 3D floor | browserSeatBindings + ingestDurableBrowserBindings (stubs); pulse/PacketFX/ticker attach-gated | Unproven — not tip SHA |
| Fully wired FE↔BE | Floor/Fleet/Agents/Setup/go-live/LI/viewport/badge ingest; campaignSeats fail-closed | Unproven |
| No theater | never invent sessionHealthy=true; liveSeats excludes LI BC; ready+healthy ≠ working without sends | Unproven |
| Ponytail | shared seatAttachedToCampaign / isBrowserComputerSeat / applyBrowserSeatBindingsToHermes | — |

## Tip closures (this goal thread)

- Durable `[]` authority (go-live / Agents / Setup)
- Floor/Fleet/Agents/LI/Setup/go-live/badge/viewport `ingestDurableBrowserBindings`
- PacketFX + ActivityTicker LI campaign attach
- `liveSeats` excludes Browser Computer; health strip send-ready
- Roster progress no LI `mode=live` green step

## Production blocker

Owner must land tip onto protected `deploy/fly-github-actions` (merge tip; keep tip on conflicted CI-fix files — already present via `8a63a8f`), wait CI+CodeQL green on that SHA, then `workflow_dispatch` Deploy Aria Mantu with `release_sha` + `recovery_receipt_sha256`, then Take→login→Release on each campaign LI desk until probe sets `sessionHealthy===true`.

- Checklist: `_relay/evidence/2026-10-03-fly-owner-deploy-path.md`
- Probe JSON: `_relay/evidence/2026-10-03-fly-owner-deploy-blocker.json`

## Post-deploy proof (required before goal complete)

```bash
TIP=$(git rev-parse origin/deploy/fly-github-actions)
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq -e --arg tip "$TIP" \
  '.build==$tip and .components.agentFrameworks==true and (.migration|test("0087"))'
# Take→login→Release per LI desk; sessionHealthy===true only after probe
```
