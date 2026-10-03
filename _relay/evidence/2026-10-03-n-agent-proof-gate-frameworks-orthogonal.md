{
  "probedAt": "2026-10-03T16:25:00Z",
  "finding": "N-agent proof must not require agentFrameworks:true",
  "evidence": [
    "https://aria-mantu-app.fly.dev/api/ready returns 503 with agentFrameworks:false while hermesRuntime:true",
    "_relay/evidence/2026-09-05-fly-linkedin-live.md documents intentional 503 without DeerFlow/Flowise",
    "probeAgentFrameworkAdapters is orthogonal to campaign-seat-attach / Browser Computer"
  ],
  "fix": "scripts/fly-n-agent-proof.sh gates build==tip, migration~0087, hermesRuntime+database/auth/queue"
}
