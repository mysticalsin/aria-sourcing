# Deployment

Canonical Fly production runbook: [`production-readiness/DEPLOYMENT_RUNBOOK.md`](production-readiness/DEPLOYMENT_RUNBOOK.md).

Production release is accepted only after the runbook's credential, recovery,
branch-protection, exact-SHA CI, and readiness gates have evidence. Use dedicated,
least-privilege deployment and registry credentials.

The Vercel `vercel-demo` branch is a separate demo path documented in the legacy
appendix. Keep its credentials and claims separate from Fly production.

Required env examples: [`.env.production.example`](.env.production.example) and [`.env.local.example`](.env.local.example).

Current release posture: [`production-readiness/STATUS.md`](production-readiness/STATUS.md).
