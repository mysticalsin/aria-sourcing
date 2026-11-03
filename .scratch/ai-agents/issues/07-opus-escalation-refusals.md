# 07 — Escalade vers Opus et gestion des refus

Status: needs-triage
Blocked by: 05
Spec: ../spec.md

## Idée
- Si un agent Sonnet ne produit pas de sortie valide après un essai, ou signale une faible confiance, une seule relance sur Opus 5.5.
- Traiter `stop_reason: refusal` et `max_tokens` explicitement. Aujourd'hui une réponse tronquée est acceptée telle quelle.

## Progress (2026-11-03)
- Refusal / `max_tokens` half shipped in commit 18919c81: `cloudStopProblem` in `src/lib/ai/provider.ts` rejects a truncated (`max_tokens`, `finish_reason: length`) or declined (`refusal`, `content_filter`) answer in the chat route and both tool loops, so callers fall back to their deterministic path. Tests: `tests/ai-provider.mts`, `tests/mcp-runtime-policy.mts`.
- Remaining: the single Opus retry. Still needs a decision on what counts as "low confidence", which tasks may escalate, and how the retry is charged against the mission budget (issue 05), so the status stays needs-triage.

## Comments
