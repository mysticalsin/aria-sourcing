# 01 — ID du workspace Anthropic et test réel

Status: resolved
Blocked by: —
Spec: ../spec.md

## Contexte
La clé de `.secret` est valide mais n'est rattachée à aucun workspace. L'API répond 400 : « This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header ». La clé reçoit un 403 sur `/v1/organizations/workspaces`.

## Critères d'acceptation
- Le propriétaire ajoute `ANTHROPIC_WORKSPACE_ID=wrkspc_…` dans `.secret`, ou remplace la clé par une clé rattachée à un workspace.
- Un appel gratuit `/v1/messages/count_tokens` répond 200 pour Haiku, Sonnet et Opus 5.5.
- Un seul appel réel par tâche (classify, outreach, chat), avec relevé de `usage`. Coût total inférieur à 0,05 $.

## Comments

## Résultat (2026-11-02)

- Le propriétaire a ajouté `ANTHROPIC_WORKSPACE_ID` dans `.secret` et une limite de dépense sur le workspace.
- `count_tokens` : 200 pour Haiku, Sonnet et Opus 5.5.
- Un appel réel par tâche via `buildCloudRequest` (mêmes profils que l'app), données fictives :

| Tâche | Modèle | Effort | Statut | Tokens in/out | Coût |
|---|---|---|---|---|---|
| classify | Haiku 5.5 | low | 200, end_turn | 105 / 23 | 0,00002 $ |
| extract (schéma JSON) | Haiku 5.5 | low | 200, end_turn, JSON valide | 1511 / 231 | 0,00027 $ |
| outreach | Sonnet 5.5 | medium | 200, end_turn | 109 / 281 | 0,00303 $ |
| chat | Sonnet 5.5 | low | 200, end_turn | 47 / 125 | 0,00134 $ |

Total : 0,0047 $. Aucun `max_tokens` ni `refusal`.

À surveiller : sans nom d'expéditeur ni d'entreprise dans le prompt, Sonnet laisse des champs `[Name]`/`[Company]`. Le prompt de l'app doit toujours les fournir (à vérifier au rejeu de « Run Aria »).
