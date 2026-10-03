# N-agent goal completion audit — tip closed / production blocked

**Tip:** `cursor/linkedin-human-claude-chrome-b91d` @ `65feac7` (PacketFX attach + ingest class)  
**Fly probe:** `21a42e7…` / migration `0084` / `agentFrameworks:false`  
**Residual hunt:** NONE (`bc-930dd13f`)  
**Verdict:** tip N-agent class **complete** / production **incomplete** — **do not UpdateGoal complete**

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

Owner must redeploy tip via protected `deploy/fly-github-actions` (`FLY_API_TOKEN` + recovery receipt + `ARIA_RELEASE_SHA=tip`), then Take→login→Release on each campaign LI desk until probe sets `sessionHealthy===true`.

Evidence: `_relay/evidence/2026-10-03-fly-owner-deploy-blocker.json`

## Post-deploy proof (required before goal complete)

```bash
TIP=$(git rev-parse HEAD)
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq -e --arg tip "$TIP" \
  '.build==$tip and .components.agentFrameworks==true'
# migration filename includes 0087
# Take→login→Release per LI desk; sessionHealthy===true only after probe
```
