---
incident_id: ARIA-SEC-2026-07-11-01
project: MSourcing / ARIA
opened_at: 2026-07-11T05:20:30Z
status: open-containment
owner: codex
---

# Fly deploy token exposure

## Classification

- **Type:** credential disclosure through internal AI tool output
- **Security severity:** high because the token may authorize Fly infrastructure changes
- **AI-incident type and severity:** output-channel leakage, HIGH
- **Data-incident severity:** SEV-4 based on current evidence
- **Personal data:** none identified
- **Candidate or client data:** none identified
- **External disclosure:** unknown; the value appeared in an internal tool result visible to Tony and the agent platform
- **GDPR Article 33 clock:** not triggered on current evidence because no personal data is known to be involved
- **EU AI Act Article 73:** assessed as not reportable on current evidence; no death, health harm, critical-infrastructure disruption, widespread fundamental-rights infringement, or serious property/environment damage is known

## Timeline

- `2026-07-11T05:20:30Z`: incident classified and Tony notified in the active task.
- A diagnostic intended to report only token-file shape parsed the raw Fly token as if it were a key/value line and printed part of the credential.
- Further credential-shape inspection stopped immediately.
- The AI workflow was restricted from any further secret-content diagnostics. A full service kill switch was not required because containment can isolate the affected credential and diagnostic pattern.
- Replacement creation was attempted with the current org deploy token and failed with `createLimitedAccessToken Not authorized`. Temporary token files were deleted. Rotation now requires Tony's personal Fly authentication or dashboard access; the compromised token remains active until that action is available.
- One controlled database start was performed after classification to capture the production exit reason. It exited with code 1 and made no volume or configuration change. After the PM review moved token containment ahead of all authenticated Fly work, further Fly-token operations were frozen pending rotation.
- The GitHub `Deploy Aria Mantu (Fly)` workflow was disabled and verified `disabled_manually`. This prevents the exposed token from being used by the existing automatic release lane while rotation is pending.
- GitHub `Production` now requires reviewer `mysticalsin` and accepts only branch `deploy/fly-github-actions`. The branch itself is still unprotected and administrator bypass remains possible.
- Local `.fly-token.env`, `.fly-secrets.env`, and `.env.local` permissions were restricted to `0600`.
- A token-free `flyctl auth whoami` check confirmed that this machine has no separate personal Fly session. Owner login is therefore required to create the replacement and revoke the exposed organization token.

## Containment

- Do not repeat the exposed value in chat, files, logs, commands, or evidence.
- Treat the current token as compromised.
- Preserve this non-secret incident record and the internal tool transcript for forensics.
- Create a short-lived, least-privilege replacement that covers only the required Fly apps or organization scope.
- Update the local ignored token file and the protected GitHub `Production` environment `FLY_API_TOKEN` secret without printing either value.
- Verify the replacement through read-only Fly calls and one controlled release dry run.
- Revoke the exposed token at the provider and record only the token ID suffix, owner, revocation time, and pass/fail result.
- Check Fly audit/activity logs for use after the exposure timestamp.

## Root cause

The diagnostic inspected a secret file's content to determine whether it used `KEY=value` syntax. A Fly token can contain `=` padding, so the script treated the token prefix as a key and emitted it. The safe pattern is to inspect only file permissions, byte count, line count, and an allowlisted format classification without ever returning content-derived substrings.

## Preventive actions

1. Add a credential-file safety test that forbids commands or scripts from printing any part of `.fly-token.env`.
2. Stop packaging multiple secrets into an opaque base64 tar. The local replacement workflow uses separate protected environment secrets; default-branch rollout is pending.
3. Keep deployment secrets as separate protected GitHub environment values with documented rotation.
4. Run pre-release secret scan independently when another CI job fails. This is implemented locally and awaits exact-SHA GitHub proof.
5. Add a 90-day maximum rotation policy for production deployment credentials.

## Closure criteria

- Replacement token installed locally and in GitHub.
- Exposed token revoked and rejected by a read-only call.
- Fly activity reviewed from the exposure timestamp.
- No secret value appears in committed evidence.
- Deployment and incident documentation updated.
