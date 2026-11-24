# 08 — SDK officiel pour le chemin Anthropic

Status: needs-triage
Blocked by: —
Spec: ../spec.md

## Contexte
Les appels Anthropic utilisent `fetch` à la main (`provider.ts`, `tool-loop.ts`). Le SDK `@anthropic-ai/sdk` apporte les types, des erreurs typées, les relances 429/5xx, le streaming et les sorties structurées.

## À vérifier
Conserver les garanties actuelles : pas de redirection suivie (SSRF), échéance globale de la boucle, contrôle d'autorité avant chaque appel externe. Le chemin OpenAI-compatible (local, autres fournisseurs) reste inchangé.

## Comments
