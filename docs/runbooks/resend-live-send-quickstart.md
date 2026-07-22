# Resend live-send quickstart — protected release path

- **Version:** 2.0
- **Last reviewed:** 2026-07-21
- **Owner:** Production release owner
- **Refresh cadence:** On release-contract change

The source send path has been exercised against a mock provider boundary. That
does not prove a real inbox delivery or authorize a production send.

> **Current stop condition:** the protected application-secret contract in
> [`deploy-fly.sh`](../../deploy-fly.sh) does not admit `RESEND_API_KEY`,
> `SENDGRID_API_KEY`, or `EMAIL_DELIVERY_WEBHOOK_SECRET`. The protected workflow
> rejects unmanaged Fly secrets. Do not run `flyctl secrets set`, and do not
> recreate or run a retired direct-deploy script. A live Resend proof is blocked
> until a reviewed change adds the delivery credential to the protected
> workflow, secret allowlist, rollback evidence, and release tests.

## 1. Prepare the provider account

1. Sign up at https://resend.com (free).
2. Verify a sender domain and its required DNS records in Resend.
3. Create a least-privilege API key. Store it only in the owner-controlled
   secret manager. Do not paste it into a command, issue, Relay note, or this
   repository.

This step prepares the external account only. It does not make ARIA ready to
send while the stop condition above remains.

## 2. Extend and review the protected secret contract

The implementation change must use the existing runtime name
`RESEND_API_KEY`; this runbook does not invent a GitHub secret name. The change
must, at minimum:

1. map an owner-controlled `Production` environment secret to
   `RESEND_API_KEY` without printing or placing it in a command argument;
2. add the runtime name to the exact application-secret allowlist in
   [`deploy-fly.sh`](../../deploy-fly.sh);
3. preserve the existing staged-secret ambiguity and rollback rules;
4. prove omission, installation, rotation, retirement, and redaction in the
   release-contract tests; and
5. pass CI and CodeQL for the exact release SHA.

Until that reviewed change exists, stop here. The application should continue
to return `dry-run` when the credential is absent.

## 3. Deploy only through the protected workflow

Follow the recovery, approval, and exact-SHA prerequisites in the
[canonical deployment runbook](../../production-readiness/DEPLOYMENT_RUNBOOK.md).
The current workflow is
[`deploy-aria-mantu.yml`](../../.github/workflows/deploy-aria-mantu.yml); it
accepts only the protected `main` ref and requires `release_sha` to equal the
commit supplying the workflow.

From a clean checkout after the reviewed delivery-secret change is merged to
`main`, set `RECOVERY_RECEIPT_PATH` to the private, independently reviewed
receipt file described by the canonical runbook, then dispatch a dark release:

```bash
gh auth status
RELEASE_SHA="$(gh api 'repos/{owner}/{repo}/commits/main' --jq .sha)"
RECOVERY_RECEIPT_SHA256="$(node scripts/recovery-receipt-digest.mjs "$RECOVERY_RECEIPT_PATH")"

gh workflow run deploy-aria-mantu.yml \
  --ref main \
  -f release_sha="$RELEASE_SHA" \
  -f recovery_receipt_sha256="$RECOVERY_RECEIPT_SHA256" \
  -f activate_sourcing=false

gh run list \
  --workflow deploy-aria-mantu.yml \
  --branch main \
  --event workflow_dispatch \
  --limit 5
```

Use the run ID returned by the list command with
`gh run watch <run-id> --exit-status`. On failure, inspect only that run with
`gh run view <run-id> --log-failed`. Replace `<run-id>` with the numeric ID from
the preceding command. Success requires the terminal `RELEASE_ACCEPTED` line
and the accepted release artifact for the same SHA. Local green checks or a
healthy `/api/health` response are not substitutes.

`RESEND_BASE_URL` is a test-harness override. Do not set it in production.

## 4. Configure one live seat and send to an owner-controlled inbox

In the app (https://aria-mantu-app.fly.dev):

1. Fleet → add/enable a seat with provider **Resend**, `status = active`,
   `mode = live`, and a verified sender domain.
2. Use one synthetic candidate record whose recipient address is controlled by
   the release owner. Do not use a real candidate for release acceptance.
3. Draft the outreach, then **Approve** it. This records the hash- and
   scope-bound human approval that the send path revalidates.
4. Click **Send**. Expect `sent`. Check the inbox.

Stop immediately if the UI reports `dry-run`, `error`, or an unknown delivery
state. Do not repeat an ambiguous attempt until the provider log has been
reconciled by its send-attempt identity.

## 5. Retain the live proof

- The email arrives (from your seat address, one-click unsubscribe present).
- `outreach_ledger` row for the candidate flips to `sent`; `rfc_message_id` is
  stamped so a delivery event can be correlated.
- Provider acceptance and inbox receipt are retained with the exact release
  SHA and send-attempt identity. Do not store the API key in the evidence.
- Bounce or complaint suppression is not live evidence until the protected
  workflow also admits and deploys the existing runtime credential used by
  `/api/webhooks/email-delivery`, and a signed provider event is observed.

## Channels beyond email

- **WhatsApp**: the source supports the official Cloud API, but its runtime
  credentials are not admitted by the current protected Fly secret contract.
  Do not set them out of band.
- **LinkedIn**: no compliant automated-send API — capture + human-sent draft by
  design; the send endpoint refuses it before any provider call.
