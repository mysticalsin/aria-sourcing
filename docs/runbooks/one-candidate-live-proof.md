# One-Candidate Live Proof — source → draft → approve → SEND

Goal: prove the whole chain end-to-end on prod by actually delivering ONE
outreach message to a candidate address you control. This is the owner-side
runbook; the parts I cannot do are the ones that require YOUR real mailbox
login (OAuth) — which is exactly as it should be.

## Prerequisites (run once, in order)
1. `bash scripts/prod-apply-swarm-fixes.sh` — brings prod to the Codex-hardened
   build (corrected migrations + app redeploy). Idempotent.
2. App is live at https://aria-mantu-app.fly.dev (the rollout deployed it).

## Why a real send needs YOUR action
`/api/outreach/send` (the button) delivers only when ALL hold — otherwise it
correctly degrades to a dry-run and the UI says "did not complete":
- seat `status = active` AND `mode = live` (not `mock`)
- `domain_verified = true` (SPF/DKIM/DMARC on the sender domain)
- a connected sender: **Microsoft Graph or Gmail OAuth** (the mailbox you log
  into), OR a `RESEND_API_KEY` / `SENDGRID_API_KEY` env secret on the app
- the message is **Approved**, and you are not in public-demo mode

The mailbox OAuth is the step only you can do — I can't (and shouldn't) log
into your Google/Outlook account.

## The proof, step by step (in the app UI)
1. **Connect a mailbox.** Fleet → add/enable a seat → connect Gmail or Outlook
   (OAuth). Use an address on a domain you can set DNS for, or use a provider
   key (Resend/SendGrid) if you'd rather skip domain setup for the test.
2. **Take the seat live.** Set the seat `mode = live`, `status = active`. Send
   auto-checks `domain_verified`; if DNS is set it flips true on first send.
3. **Source one candidate.** Use the sourcing view; for the test, add ONE
   candidate whose email is an address YOU control (e.g. a personal inbox).
4. **Draft the outreach.** Generate/write the message. This is where the swarm
   drafter would produce copy once you wire an executor — for the proof, the
   built-in draft is enough. Keep it a real, personalized message.
5. **Approve it.** The approval records the hash+scope-bound approval row that
   the send path re-verifies. This is the never-auto-send gate: nothing leaves
   without this human click.
6. **Click Send.** Watch the result:
   - `sent` → delivered. Check the recipient inbox. **This is the proof.**
   - "dry-run"/"did not complete" → the seat isn't live or no mailbox is
     connected. Fix step 1-2; the code is correct, the config isn't live yet.

## Verify delivery (belt and braces)
- The recipient inbox receives the mail (RFC 5322 Message-ID from the sender
  domain, one-click unsubscribe link present).
- `messages_outbound` row for the candidate flips to a sent/accepted state;
  `outreach_ledger` records the send. A reply threads back via the Message-ID.

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

## What "fully working" means after this
- Email: automated, human-approved, delivered — proven by this runbook.
- WhatsApp: same gate, official Cloud API, ready when you connect a number.
- LinkedIn: capture + human-sent draft (by design).
- Swarm: enabled DARK; wire an executor URL (Dust/Flowise/Claude runner) to
  have agents produce the drafts automatically — the human approval + send
  gate is unchanged and remains the only path to a candidate.
