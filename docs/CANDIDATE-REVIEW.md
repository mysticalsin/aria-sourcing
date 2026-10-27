# Review a sourced candidate

Use the existing connected workspace, campaign candidate list and candidate
drawer. The **Next action** column and drawer summary explain what remains:

| Next action | Recruiter action |
|---|---|
| Contact blocked / outside active shortlist | Respect the exclusion or existing disposition. No enrichment/new draft from this drawer. |
| Review campaign | Complete the brief and use an active Sourcing/Outreach campaign. |
| Verify fit | Compare observed skills with the brief; check missing skills and required experience. A search query is not evidence. |
| Find email contact | Verify contact details or review enrichment. A LinkedIn-only profile can have an assisted LinkedIn draft. |
| Record contact basis | Record the applicable operator decision in the consent passport before message approval. |
| Review outreach draft | Prepare/review the exact text in the existing queue; delivery checks and human approval still apply. |

These are review prompts, not automatic qualification or permission to send.

## Record verified facts

1. Open a candidate and, when confidentiality mode hides personal data, use the
   existing purpose-based reveal before reviewing contact details.
2. In **Verified profile and contact**, record the observed skills, verified
   experience (optional), public email and/or verified LinkedIn `/in/` URL.
3. Leave unknown experience blank. Work-history text is never automatically
   converted into a number of years.
4. Enter **Where you verified it**: the source URL or an explicit verification
   note. Click **Save verified evidence** and wait for confirmation.
5. The action saves a source note and recomputes the score. Contact identities
   that collide with another candidate are refused for manual review; records
   are never merged just because names match.

This uses the shared workspace's optimistic concurrency and erasure guards.
Failed/conflicting saves are shown as failures. Recording facts does not change
the stage, record a lawful basis, create an outreach approval or send anything.
Real profile editing/enrichment requires the connected backend; the synthetic
quick-look showcase remains separate.

In the **Consent passport**, use **Contact basis** and **Basis evidence or
reference** to record the applicable explicit decision, then **Record contact
basis**. This is a separate action: saving profile facts never selects a basis.
The display uses the same complete operator receipt as the approval gate;
public-profile provenance alone never supplies it.

## Review enrichment before starting

- Configure the workspace Apify key under **Settings -> API keys**. Enrichment
  uses `dev_fusion/linkedin-profile-scraper`, a different actor from initial
  LinkedIn discovery. Its access/owner approval and allowance must also be
  available; an actor approval refusal is surfaced explicitly.
- The current provider requires a LinkedIn profile URL. GitHub-only profiles
  without one need verified identity/contact research first. No identity is
  guessed from a name, and no LinkedIn login is automated.
- **Review enrichment** lists missing fields supported by the configured
  provider. Phone is not promised by the current provider. Confirm the reviewed
  request before a paid call; profile/count/unit limits are not currency prices.
- The server loads the saved candidate and campaign, rejects excluded profiles
  or inactive/incomplete briefs, and rescales the score from actual returned
  evidence. Experience, education and languages are preserved.
- A provider refusal, missing key/identity or exhausted budget is distinct from
  a successful provider response containing no new data. Review the saved
  per-provider attempt history. Partial results remain explicit.
- Keep the page open until saving completes. This enrichment path is synchronous;
  unlike durable campaign discovery, it does not resume a lost response after
  closing the tab. Interrupted/uncertain paid requests are never automatically
  retried. Check the provider before deliberately starting another request.
- Concurrent identity/evidence changes, erasure or a workspace switch invalidate
  the response. Failed persistence is never reported as completed enrichment.

## Prepare a draft

With no email but a LinkedIn profile, **Draft LinkedIn message** selects assisted
LinkedIn drafting. Otherwise **Generate outreach** prepares an email draft when
an email is present. The existing template fallback works without a model key;
GPT/Claude setup remains optional for this test.

Use **Review outreach queue** for the existing human approval workflow. A high
score, a verified email or a draft alone does not authorize delivery. The consent
passport and all existing approval checks remain required. No message is sent by
the qualification, evidence or enrichment actions above.

For the other machine's setup and live-provider acceptance, see
[LOCAL-SOURCING-TEST.md](LOCAL-SOURCING-TEST.md). Browser/API fixture checks can
validate this journey without using a real provider token or sending outreach.
