# Durable run and campaign journey
Status: ready-for-human
Type: task

Implement the acceptance criteria in ../spec.md, adversarially test concurrency,
workspace isolation, partial failures and refresh recovery, and record evidence.

## Comments

2026-10-27 Codex: implementation and fixture/browser acceptance complete; see
the spec for evidence. Real Apify account and Docker acceptance remain for the
owner's other machine/CI. No paid source, model or outbound message was invoked.

Final code 43b9db34 passed CI 40499885119 and CodeQL 40499885130, including
actual PostgreSQL and Docker refresh/restart/credential persistence. Only the
real paid-provider smoke test remains an operator acceptance boundary.
