# Sourced profile to draft review

Status: ready-for-human

Reuse the candidate drawer, scoring, enrichment waterfall, consent passport and
approval queue. No new model/container/provider and no real external calls.

Acceptance:
- Candidate list and drawer show the next action, separating missing evidence,
  missing contact details, recorded contact permission and draft review.
- Show observed/missing required skills without fabricating experience or treating
  a search query as evidence. A score is not an approval to contact.
- Allow an operator to record verified email/LinkedIn contact with a source note,
  duplicate checks and durable saving, separately from recording contact permission.
- Enrichment loads the saved candidate and campaign under the signed-in workspace;
  client profile fields never authorize paid provider access or supply scores.
- Reject erased/excluded candidates and inactive campaigns before provider access.
- Review the requested fields and paid-provider implication before enrichment.
  Missing key/identity and provider errors must not look like successful discovery.
- Preserve experience, education and languages, rescore with the saved brief and
  persist the returned patch before reporting success. Preserve concurrent edits
  via existing optimistic concurrency and erasure guards. No automatic paid retry.
- Drafting and human approval remain distinct; no message is sent by this slice.
- Run typechecks, application tests, lint/build and a fixture browser journey.

The existing enrichment API is synchronous. Durable background enrichment recovery
is outside this slice: closing the tab before the response can lose the response.
Do not promise resumable paid enrichment or automatically repeat an interrupted
request. Campaign discovery already has its own durable jobs.

## Verification

Local typechecks, the complete npm test lifecycle, lint and production build passed.
Lint retains only the two existing navigation warnings. Final focused tests cover
workspace switches during save/provider work, concurrent edits, erasure, provider
refusal, explicit basis receipts and serialized batch saves. A 1280x720 Edge
fixture journey passed through enrichment, manual evidence, assisted LinkedIn
drafting, email, explicit basis and refresh persistence with zero provider starts
and zero outbound messages. Live Apify acceptance remains external.
