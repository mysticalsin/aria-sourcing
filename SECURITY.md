# Security policy and engineering invariants

ARIA processes candidate data, credentials, and external communication
authority. Treat suspected exposure, cross-tenant access, unauthorized delivery,
and lost audit evidence as security events.

## Reporting a vulnerability

Do not open a public issue containing credentials, candidate data, exploit
details, tenant identifiers, or provider responses.

Use the repository's private security-advisory channel or the designated
internal security contact. Include:

- affected commit, route, or component;
- reproducible steps using synthetic data;
- expected and observed authority;
- whether external delivery, credential access, or candidate data may be
  involved;
- logs with secrets and personal data removed.

No response-time commitment is published in this repository. If a production
credential or live tenant may be affected, revoke or isolate access first and
preserve an evidence timeline.

## Credential exposure response

1. Stop using the credential.
2. Terminate processes or jobs that may still carry it.
3. Revoke it at the issuing provider.
4. Issue a least-privilege replacement.
5. Review provider and repository access history.
6. Update only the approved secret store.
7. Record rotation metadata, never the old or new value.
8. Re-run secret scans before release.

Never place credentials in command arguments, process listings, Relay notes,
test fixtures, screenshots, URLs, or committed environment files.

## Security invariants

- Production without required Supabase authority fails closed.
- API identity, role, workspace, owner, and email-domain policy are enforced on
  the server.
- RLS denies cross-workspace access; service-role use is restricted to
  server-only operations.
- Agent memory and runs are scoped by workspace, owner, and AgentSpec.
- Missing or ambiguous candidate conversation identity goes to triage.
- Agent graph output has no provider delivery authority.
- Every real outbound message needs exact human approval plus dispatch-time
  suppression, consent, capacity, sender, and provider validation.
- Unknown provider acceptance is non-retryable until reconciled.
- Secret-bearing integration origin and credential bindings are normalized,
  admin-owned, and purpose-bound.
- Public fetches reject private, reserved, metadata, redirect, and DNS-rebinding
  targets.
- Public demo mode cannot reach live side effects.
- LinkedIn automation, scraping, session reuse, and rate-limit bypass are not
  permitted.

## Local verification

```bash
npm run test:security
npm audit --audit-level=high
gitleaks git --redact --log-opts="--all"
```

Network-dependent checks must be reported as blocked if the registry or provider
is unreachable. Do not turn a failed security check into a warning-only path to
make a release green.

Database authority changes also require:

```bash
npm run test:db-privileges
npm run test:db-agent-memory
npm run test:db-cross-channel-cap
```

## Supported source

Security fixes target the current integration source and the exact protected
release candidate. Historical audit documents and older deployed builds are not
supported evidence of the current security posture.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for trust boundaries and
[`production-readiness/DEPLOYMENT_RUNBOOK.md`](production-readiness/DEPLOYMENT_RUNBOOK.md)
for protected release controls.
