# ARCHIVED: contract for the superseded agent-framework workflow draft

The executable handoff is `_relay/HANDOFF.md`; the canonical workflow is
`.github/workflows/deploy-agent-frameworks.yml` on protected `main`.

# Rocket Fuel — CONTRACT
Mode: plan-review · Date: 2026-07-19
Visionary: Claude (Opus 4.8) · Integrator: Codex (gpt-5.5) · Owner: Tony
Artifact under review: .github/workflows/deploy-agent-frameworks.yml (agent-framework supply-chain CI pipeline)
Goal: a workflow that builds+signs 8 framework images so operator.mjs cosign verify/verify-attestation/trivy pass → enables /api/ready agentFrameworks green.
