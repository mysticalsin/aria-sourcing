# N-agent goal completion audit — tip vs production

**Audited tip:** `cursor/linkedin-human-claude-chrome-b91d` (durable roster ingest + Agents/Settings ingest)  
**Fly probe:** `21a42e7…` / migration `0084` / `agentFrameworks:false`  
**Verdict:** tip N-agent class **OK** / production **incomplete** — do not UpdateGoal complete

## Requirements

| Requirement | Tip evidence | Production evidence |
|---|---|---|
| N agents real (1 seat = 1 VM/LI) | attach gates + BC empty≠attached; migrations 0085–0087 on tip | Fly still 0084; agentFrameworks false |
| Isolated profiles | refuseUnattached + campaignId on LI login when attached | Unproven on stale build |
| Visible on 3D floor | `browserSeatBindings` + `ingestDurableBrowserBindings` (append stubs + patch); pulse attach-gated | Unproven — Fly not tip SHA |
| FE↔BE wired | Floor/Fleet/Agents/Setup/LI settings sync durable; campaignSeats fail-closed | Unproven |
| No theater | never invent sessionHealthy=true; ready+healthy ≠ working without sends; unknown LI status idle | Unproven |
| Ponytail | shared attach + hermes sync helpers | — |

## Blocker

Owner Fly tip redeploy via protected `deploy/fly-github-actions` + Take→login→Release per LI desk until `sessionHealthy===true` from probe only.

## Post-deploy proof

```bash
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq -e --arg tip '<tipSha>' \
  '.build==$tip and .components.agentFrameworks==true'
# migration filename includes 0087
```
