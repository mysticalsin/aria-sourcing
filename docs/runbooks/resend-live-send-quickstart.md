# Resend live-send quickstart — turn the proven send path into real inbox delivery

The send code is proven end-to-end (see the SEND-PATH E2E: it delivers a
correct, compliant email — recipient, subject, plain+HTML body, one-click
unsubscribe, RFC Message-ID, send-attempt header — to the provider). The only
remaining atom is a provider credential. Resend is the fastest: free tier, no
card, ~2 minutes.

## 1. Get a Resend API key (test mode works without a domain)
1. Sign up at https://resend.com (free).
2. Dashboard → API Keys → Create → copy the `re_...` key.
3. Resend test mode: you can send to the email you signed up with (your own
   inbox) without verifying a domain. To send from your own domain later, add
   it under Domains and set the SPF/DKIM DNS records Resend shows.

## 2. Set the key as a prod secret and redeploy
```bash
# from repo root, YOUR terminal
export FLY_API_TOKEN="$(cat production-readiness/.fly-token.env)"
flyctl secrets set RESEND_API_KEY="re_your_key_here" -a aria-mantu-app
# secrets set triggers a rolling restart; if not, redeploy the app:
bash scripts/prod-deploy-app.sh
```

## 3. (Optional) dry-run against a mock first
The code honours `RESEND_BASE_URL` — point it at a mock to watch the exact email
without sending, then unset it to go live. The proof harness in
scratch (`flat/proof.mjs`) shows the captured payload.

## 4. Configure a live Resend seat + send one candidate
In the app (https://aria-mantu-app.fly.dev):
1. Fleet → add/enable a seat with provider **Resend**, `status = active`,
   `mode = live`. (Resend needs no `domain_verified` for test-mode sends to your
   own address; for a custom domain, verify DNS first.)
2. Source ONE candidate whose email is an address YOU control (your Resend
   signup inbox for the first test).
3. Draft the outreach → **Approve** it (this records the hash+scope-bound human
   approval the send path re-verifies — the never-auto-send gate).
4. Click **Send**. Expect `sent`. Check the inbox.

## 5. Verify the full loop
- The email arrives (from your seat address, one-click unsubscribe present).
- `outreach_ledger` row for the candidate flips to `sent`; `rfc_message_id` is
  stamped (so a bounce/complaint webhook can correlate + suppress).
- If you wire Resend's delivery webhook to `/api/webhooks/email-delivery` with
  `EMAIL_DELIVERY_WEBHOOK_SECRET`, a hard bounce or complaint auto-suppresses
  the address (proven: reactivates an expired suppression, replay-idempotent,
  soft→permanent handled).

## Channels beyond email
- **WhatsApp**: same gate, official Cloud API — set `WHATSAPP_TOKEN` +
  `WHATSAPP_PHONE_NUMBER_ID`, register a sender on a live WhatsApp Cloud seat.
- **LinkedIn**: no compliant automated-send API — capture + human-sent draft by
  design; the send endpoint refuses it before any provider call.
