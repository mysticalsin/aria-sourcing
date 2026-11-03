# 04 — Cache des prompts

Status: ready-for-human
Blocked by: 02
Spec: ../spec.md

## Critères d'acceptation
- `cache_control` sur les prompts système et les définitions d'outils stables (sourcing, chat).
- Aucun contenu variable (date, identifiants) avant le dernier point de cache.
- Le journal d'usage (WP 02) montre `cache_read_input_tokens` > 0 sur des appels répétés. Si ce n'est pas le cas, le prompt est trop court pour être mis en cache : on le documente et on n'ajoute rien.

## Comments

### 2026-11-03 — claude-code
- Boucle d'outils (`src/lib/ai/tool-loop.ts`) : point de cache explicite sur le prompt système (`anthropicCachedSystem`, `src/lib/ai/provider.ts`) + cache automatique (`cache_control` au niveau de la requête) qui avance jusqu'au dernier message. Le tour N+1 relit tout ce que le tour N a envoyé (outils, système, historique, résultats d'outils).
- Appels simples (`buildCloudRequest`) : rien ajouté, comme prévu par le 3e critère. Les prompts `TASK_SYSTEM` font ~40 à ~210 tokens, sous le minimum de 512 tokens des modèles 5.5, et le contenu utilisateur change à chaque appel.
- Aucun contenu variable avant les points de cache : les définitions d'outils et `TASK_SYSTEM` sont fixes.
- Reste à vérifier en réel (non fait, coût) : une question de chat qui déclenche au moins 2 tours d'outils doit montrer `cache_read_input_tokens` > 0 dans le journal (`/costs`).
