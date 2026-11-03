---
project: MSourcing / ARIA
date: 2026-07-09
status: local-code-verification-passed
scope: release-verification
---

# Production verification record

## Passed in the source checkout

```text
npx tsc --noEmit                         PASS
npm run test                             PASS
npm run build                            PASS
git diff --check                         PASS
npm audit --omit=dev --audit-level=high  PASS
```

The production build compiles all 56 static routes and dynamic API routes without the earlier NFT tracing warning. The build no longer relies on runtime process spawning for the browser-research sidecar.

The test suite includes 105 human-likeness cases, 40 WhatsApp/autopilot cases, 36 dispatcher cases, 27 browser-tool cases, and all pre-existing platform suites. Expected negative-path test logs remain visible:

- Dust invalid-key fixtures report HTTP 401 and pass.
- The WhatsApp dispatcher injects a cache-store error and confirms that the message blocks before a claim or provider call.

## Audit result

`npm audit --omit=dev --audit-level=high` exits successfully. It reports two moderate findings through Next's nested PostCSS dependency. The only offered remediation is `npm audit fix --force`, which proposes a downgrade to Next 9.3.3. Do not apply that forced change. Track the upstream Next/PostCSS update and reassess when a non-breaking remediation is available.

## Browser research policy correction

The prior browser-sidecar runtime exposed stealth, private-network access, and text-entry or arbitrary-evaluation actions. That conflicted with ARIA's documented source-policy and public, read-only research posture.

The runtime now:

- connects only to an explicitly provisioned sidecar in production;
- identifies itself as `ARIAResearchBot/1.0`;
- does not enable stealth or private-network flags;
- exposes only click, scroll, wait, back, and forward actions;
- continues to enforce SSRF and robots.txt checks before open and after navigation.

## Still required before a live release

Local code proof is not deployment proof. The release remains blocked on:

1. applying migrations through `0009` to the target Supabase project;
2. staging RLS, service-role claim, idempotency, and webhook-replay evidence;
3. a configured Flowise sidecar, approved Flowise operating model, and production secret path;
4. a registered Meta sender, approved templates, verified opt-ins, and signed webhook evidence;
5. a deployed commit and release-health evidence from the production host.

Local Supabase lint could not run because Docker is not running on this workstation. It is a release verification task for staging, not a reason to bypass the migration checks.
