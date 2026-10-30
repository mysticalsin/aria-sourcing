# 01 — ID du workspace Anthropic et test réel

Status: ready-for-human
Blocked by: —
Spec: ../spec.md

## Contexte
La clé de `.secret` est valide mais n'est rattachée à aucun workspace. L'API répond 400 : « This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header ». La clé reçoit un 403 sur `/v1/organizations/workspaces`.

## Critères d'acceptation
- Le propriétaire ajoute `ANTHROPIC_WORKSPACE_ID=wrkspc_…` dans `.secret`, ou remplace la clé par une clé rattachée à un workspace.
- Un appel gratuit `/v1/messages/count_tokens` répond 200 pour Haiku, Sonnet et Opus 5.5.
- Un seul appel réel par tâche (classify, outreach, chat), avec relevé de `usage`. Coût total inférieur à 0,05 $.

## Comments
