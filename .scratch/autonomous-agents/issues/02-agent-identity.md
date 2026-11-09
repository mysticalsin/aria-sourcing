# 02 — Identité agent et délégation

Status: ready-for-agent
Blocked by: —
Spec: ../spec.md

## À faire
- Une table de délégations : (workspace, utilisateur, scopes, plafonds, `token_hash`, `revoked_at`).
- Scopes : `source`, `draft`, `queue_linkedin`, `send_email`.
- `requireAgent(req, scope)` renvoie `{ workspaceId, onBehalfOf }`. Le jeton est comparé par SHA-256, comme pour l'appairage du pont.
- Réglages : « Autoriser l'agent à agir pour moi », révocable en un clic.
- Historique du candidat : « par l'agent pour <utilisateur> ».

## Critères d'acceptation
- Une délégation révoquée, ou un scope absent, donne 403 sur chaque route agent.
- Un `onBehalfOf` qui a perdu son rôle donne 403.

## Comments
