# One-Candidate Live Proof — source → draft → approve → SEND

Goal: prove the whole chain end-to-end on an accepted production release by
delivering one outreach message to a synthetic candidate address controlled by
the release owner. This is not part of automated release acceptance, and it
must never use a real candidate as test data.

**Current status:** blocked for provider-key delivery. The protected Fly
application-secret contract does not currently admit `RESEND_API_KEY`,
`SENDGRID_API_KEY`, or WhatsApp delivery credentials. Do not bypass that
contract with `flyctl secrets set` or a retired production script. Follow the
[Resend protected-release runbook](resend-live-send-quickstart.md) for the exact
stop condition and required release-contract change.

## Prerequisites (run once, in order)

1. The reviewed SHA is merged to protected `main`, and CI plus CodeQL have
   completed successfully for that exact SHA.
2. The release owner follows the
   [canonical deployment runbook](../../production-readiness/DEPLOYMENT_RUNBOOK.md)
   and dispatches
   [`deploy-aria-mantu.yml`](../../.github/workflows/deploy-aria-mantu.yml) on
   `main`. The visible `release_sha` must equal the commit supplying the
   workflow, and `recovery_receipt_sha256` must match the independently
   reviewed private recovery receipt.
3. The protected `Production` approval is independent, and the run ends with
   `RELEASE_ACCEPTED` plus an accepted release artifact for that SHA.
4. If autonomous sourcing is required, the same workflow is dispatched with
   `activate_sourcing=true`. It must receive a separate independent approval in
   `Production-Sourcing-Activation` and end with `SOURCING_ACTIVATED`. Its
   canary is intentionally no-contact; it does not prove email delivery.
5. `/api/ready` is HTTP 200 for the exact running SHA, including operational
   sourcing readiness when Step 4 applies.
6. A reviewed protected-release change has admitted one delivery provider
   credential, and that provider's sender/domain configuration is verified.

Any missing prerequisite is a stop condition, not permission to deploy or
configure Fly directly.

## Why a real send needs YOUR action
`/api/outreach/send` delivers only when all of the following hold. Otherwise it
fails closed or returns a non-send result:

- seat `status = active` AND `mode = live` (not `mock`)
- `domain_verified = true` (SPF/DKIM/DMARC on the sender domain)
- a connected sender: **Microsoft Graph or Gmail OAuth** (the mailbox you log
  into), OR a `RESEND_API_KEY` / `SENDGRID_API_KEY` env secret on the app
- the message is **Approved**, and you are not in public-demo mode

Mailbox login and provider-account approval remain owner actions. Do not assume
an OAuth or provider integration works because its UI is visible; retain its
own live acceptance evidence.

## The proof, step by step (in the app UI)

1. **Select the protected provider path.** In Fleet, add or enable the provider
   whose credential passed Prerequisite 6. Use a sender on the verified domain.
2. **Take the seat live.** Set the seat `mode = live`, `status = active`, and
   confirm `domain_verified = true` before attempting delivery.
3. **Source one synthetic candidate.** Use the sourcing view and an address
   controlled by the release owner. Do not use a real candidate in this proof.
4. **Draft the outreach.** Use the activated sourcing flow or write the message
   in the application. Keep the synthetic proof content specific and harmless.
5. **Approve it.** The approval records the hash+scope-bound approval row that
   the send path re-verifies. This is the never-auto-send gate: nothing leaves
   without this human click.
6. **Click Send.** Watch the result:
   - `sent` → the provider accepted the request. Check the recipient inbox.
   - `dry-run` or `did not complete` → no message was sent. Recheck the
     prerequisites; do not claim delivery.
   - transport error or unknown delivery state → do not retry until the
     provider log is reconciled by the immutable send-attempt identity.

## Verify delivery (belt and braces)

- The recipient inbox receives the mail (RFC 5322 Message-ID from the sender
  domain, one-click unsubscribe link present).
- `outreach_ledger` records the accepted send with its immutable attempt and
  RFC Message-ID. Do not claim reply ingestion unless a controlled reply is
  separately observed and correlated.

## LinkedIn — the honest answer
LinkedIn has **no official, compliant API for sending outbound messages to
arbitrary candidates.** The Marketing/Talent APIs don't expose free-form
member-to-member messaging for cold outreach, and automating InMail/messages
through the private web endpoints violates LinkedIn's User Agreement and gets
accounts restricted. So the platform's LinkedIn channel is deliberately scoped
to: capturing a profile as a candidate, drafting outreach a human then sends
**manually** inside LinkedIn, and (where you have LinkedIn Recruiter) using its
own InMail — never an automated send from this app. Email is the compliant
automated channel; WhatsApp Cloud is the second (official Business API). The
send endpoint already rejects any channel without an official integration
before it touches a provider — that rejection is the guardrail, not a gap.

## What this proof establishes

- Email: one human-approved synthetic message was accepted and observed in an
  owner-controlled inbox on one exact release.
- WhatsApp: no claim. It requires its own protected credential path, registered
  sender, consent/template controls, durable dispatch, and live proof.
- LinkedIn: capture + human-sent draft (by design).
- Autonomous sourcing: no delivery authority. A passing protected activation
  can source and draft, but the human approval and outreach send controls remain
  separate.

This proof does not establish fleet capacity, multitenant isolation under load,
bounce/complaint processing, or campaign-wide reliability. Retain it as one
release-bound acceptance artifact only.
