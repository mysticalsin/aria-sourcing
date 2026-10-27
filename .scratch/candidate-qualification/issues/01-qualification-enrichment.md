# Candidate qualification and enrichment journey
Status: ready-for-human
Type: task

Implement the parent spec using the existing candidate workflow. Audit findings
belong in `_relay/codex-findings.md`. Real Apify acceptance remains blocked by the
actor allowance; verification uses fixtures and no paid provider starts.

## Verification

Implemented the parent acceptance with shared review/evidence helpers, an
ID-only workspace-authoritative enrichment route and persistence-aware store
actions. Full local gate/build/lint and a fixture browser journey passed.
See docs/CANDIDATE-REVIEW.md and issue 02 for synchronous enrichment limitations.
No real external provider or outreach was used.
