# Durable enrichment recovery after an interrupted request
Status: ready-for-agent
Type: task

The existing enrichment API is synchronous. Candidate/workspace authority,
before/after evidence checks and verified persistence are implemented, but tab
closure before receiving the response can still lose the result. Separate tabs
or operators can also explicitly submit independent enrichment requests. A
component/store lock is not cross-process paid-call idempotency.

Future slice: durable workspace/candidate-bound enrichment jobs, recorded intent
before paid egress, resumable result persistence and explicit uncertain-start
handling. Preserve privacy/erasure, budget and role boundaries, avoid duplicate
spend, and never automatically replay ambiguous provider requests. This requires
its own forward migration and PostgreSQL/concurrency acceptance.

Until then, keep the page open and verify provider state before another paid
request. Do not claim campaign sourcing's durable recovery applies to enrichment.
