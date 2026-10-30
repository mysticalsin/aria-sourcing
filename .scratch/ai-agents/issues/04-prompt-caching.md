# 04 — Cache des prompts

Status: ready-for-agent
Blocked by: 02
Spec: ../spec.md

## Critères d'acceptation
- `cache_control` sur les prompts système et les définitions d'outils stables (sourcing, chat).
- Aucun contenu variable (date, identifiants) avant le dernier point de cache.
- Le journal d'usage (WP 02) montre `cache_read_input_tokens` > 0 sur des appels répétés. Si ce n'est pas le cas, le prompt est trop court pour être mis en cache : on le documente et on n'ajoute rien.

## Comments
