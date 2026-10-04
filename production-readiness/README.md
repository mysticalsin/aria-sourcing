# Production-readiness documentation

This directory contains two different kinds of material:

1. Current release and operating instructions.
2. A dated 2026-06-27 audit set retained for traceability.

Do not treat a historical report as current source, release, or live evidence.

## Current entry points

| File | Use |
|---|---|
| [`STATUS.md`](STATUS.md) | Current source and release-gate posture |
| [`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md) | Canonical Fly production release and recovery procedure |
| [`LOCAL_SETUP.md`](LOCAL_SETUP.md) | Local Supabase setup and recovery commands |
| [`DATABRICKS_AUTHORITY_MIGRATION.md`](DATABRICKS_AUTHORITY_MIGRATION.md) | Databricks authority migration procedure |
| [`GOOGLE_OAUTH_SETUP.md`](GOOGLE_OAUTH_SETUP.md) | Google OAuth integration setup |

The root [`DEPLOYMENT.md`](../DEPLOYMENT.md) is the short entry point.
The developer architecture of record is
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Separate demo path

The Vercel demo is not the Fly production environment. Its instructions are:

- [`DEPLOY_VERCEL_DEMO.md`](../DEPLOY_VERCEL_DEMO.md)
- [`VERCEL_GOLIVE.md`](VERCEL_GOLIVE.md), retained as a legacy checklist
- [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md), retained as the older
  Supabase Cloud and Vercel checklist

Do not apply those Vercel migration or secret steps to the Fly production
database.

## Historical audit set

Files with a `SUPERSEDED` notice at the top capture the 2026-06-27
readiness review. They can explain why a control was added, but their stack
versions, route counts, test counts, findings, and release verdicts may be
stale.

Use [`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md) to navigate that dated audit.
Validate every historical finding against current code and tests before acting
on it.

## Evidence rule

Keep these claims separate:

| Claim | Minimum evidence |
|---|---|
| Source ready | Exact source SHA and local or CI gates |
| Release eligible | Protected exact-SHA checks, recovery receipt, approvals, scans, and attestations |
| Live healthy | Running digest, full migration identity, dependency readiness, restart persistence, login, and campaign acceptance |

If one layer lacks evidence, report it as unknown or incomplete. Never use a
green source test to claim the live deployment is healthy.
