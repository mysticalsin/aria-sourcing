# Couche IA d'ARIA : agents Claude et usage maîtrisé

Date : 2026-10-30 · Branche : mbe-branch · Statut : socle livré (WP 00), le reste est à faire

## 1. Décisions du propriétaire

- Toute la partie IA de l'app utilise une seule clé Anthropic (Claude).
- Sur un poste de dev, la clé est dans `.secret` à la racine. Ce fichier est ignoré par git et exclu du contexte Docker.
- Chaque partie utilise le modèle adapté à sa tâche. On n'emploie pas le plus gros modèle partout.
- L'app aura un système d'agents qui lancent (spawn) des sous-tâches. L'IA reste un coût piloté, pas un réflexe.

## 2. Ce qui existe déjà (vérifié dans le code)

| Surface | Fichier | Tâche (`HermesTask`) | Repli sans IA |
|---|---|---|---|
| Analyse d'un brief ou d'un email de besoin | `src/lib/ai/intake.ts` | `chat` | heuristique `parseEmailAndJD` |
| Rédaction des messages d'approche | `src/lib/store.ts` → `/api/hermes/chat` | `outreach` | gabarit `generateOutreach` |
| Classification des réponses candidats | `src/lib/store.ts` → `/api/hermes/chat` | `classify` | lexique `classifyReply` |
| Agent de sourcing (boucle d'outils) | `src/app/api/sourcing-agent/route.ts` | `sourcing` | GitHub déterministe |
| Assistant (chat + recherche web) | `/api/hermes/chat` | `chat` | réponse mock |
| Rapport hebdo, emails de booking | `src/lib/mock-ai.ts` | aucune | 100 % déterministe |

Tous les appels passent par le serveur. Le secret ne quitte jamais le serveur. Chaque appel a un repli déterministe. On garde ce contrat.

Contraintes à respecter :
- ADR 0001 : pas de serveur IA séparé ni d'orchestration de workers externe. Les agents tournent dans le processus Next.js.
- Le sourcing ne dépense qu'une clé de workspace créée par un admin (vault), jamais la clé d'environnement. La route chat accepte la clé d'environnement pour un admin seulement.
- Aucun envoi sans validation humaine (`humanApprovalGate`).

## 3. Principes d'usage

1. **Le déterministe d'abord.** Dédoublonnage, scoring, métriques, règles de conformité et gabarits restent du code. Le modèle n'intervient que pour le langage : comprendre, rédiger, classer un texte libre.
2. **Un modèle par niveau de difficulté.** On prend le modèle le moins cher qui tient la qualité, puis on mesure. On ne monte d'un niveau que sur preuve.
3. **Un effort de réflexion par tâche.** Les modèles Claude actuels réfléchissent par défaut, et cette réflexion consomme des tokens de sortie. L'effort (`low`, `medium`, `high`) est fixé par tâche dans `ANTHROPIC_TASK_PROFILE`.
4. **Le cache sur les prompts stables.** Les prompts système et les définitions d'outils restent fixes. Le contenu variable (date, campagne) va en fin de prompt.
5. **La Batch API pour ce qui n'est pas urgent.** Elle coûte 50 % moins cher. Exemples : rapport hebdo, requalification d'un vivier, résumés nocturnes.
6. **Des budgets visibles.** Chaque appel enregistre ses tokens et son coût estimé. Un plafond par workspace et un interrupteur coupent l'IA sans casser l'app, puisque les replis existent.

## 4. Routage des modèles

Le socle est livré : les tâches existantes passent sur Claude.

| Tâche | Modèle | Effort | `max_tokens` | Pourquoi |
|---|---|---|---|---|
| `classify` : réponse candidat → intention | Claude Haiku 5.5 | low | 1024 | volume élevé, sortie courte et structurée |
| `chat` : assistant, analyse de brief | Claude Sonnet 5.5 | low | 8192 | réponses conversationnelles, outils web |
| `outreach` : message d'approche | Claude Sonnet 5.5 | medium | 8192 | qualité rédactionnelle, ton, langue |
| `sourcing` : boucle d'outils | Claude Sonnet 5.5 | medium | 16000 | appels d'outils fiables sur plusieurs tours |
| Escalade (WP 07) | Claude Opus 5.5 | high | | seulement si un agent échoue ou doute |

Prix indicatifs par million de tokens (entrée / sortie) : Haiku 5.5 à 0,10 $ / 0,50 $, Sonnet 5.5 à 2 $ / 10 $, Opus 5.5 à 4 $ / 20 $. Une classification coûte donc environ 20 fois moins sur Haiku que sur Sonnet.

Opus est enregistré mais n'est le défaut d'aucune tâche. Un admin peut le choisir pour une tâche dans Réglages → IA & modèles.

## 5. Système d'agents (cible)

Un **orchestrateur** côté serveur reçoit une mission, par exemple « lancer la campagne X ». Il la découpe en étapes. Pour chaque étape, il lance un **agent** : un appel borné, ou une boucle d'outils bornée, avec un modèle, un effort, un budget et un délai.

```
Mission (AgentRun) ── budget, délai, annulation, journal d'audit
 ├─ étape 1  Analyse du brief        Haiku   (sortie structurée)
 ├─ étape 2  Stratégie de sourcing   Sonnet
 ├─ étape 3  Sourcing                Sonnet  (boucle d'outils)
 ├─ étape 4  Qualification ×N        Haiku   (en parallèle, limite de concurrence ; Batch si N est grand)
 ├─ étape 5  Rédaction ×K            Sonnet  → file d'approbation humaine
 └─ escalade éventuelle              Opus    (sur échec ou faible confiance)
```

Règles :
- **Budget hérité.** Une mission a un plafond en tokens et en euros. Chaque agent lancé consomme ce budget et ne peut pas le dépasser.
- **Concurrence limitée.** Par exemple 4 agents en parallèle par workspace, pour respecter les limites de débit de l'API.
- **Résultat structuré.** Chaque agent renvoie un objet validé par un schéma (structured outputs), jamais du texte à re-parser.
- **Repli.** Si un agent échoue, l'étape bascule sur sa version déterministe et la mission continue.
- **Traçabilité.** Pour chaque appel on journalise la mission, l'étape, le modèle, les tokens (entrée, sortie, cache) et le coût estimé. On ne journalise jamais le contenu des candidats.
- **Annulation.** Un utilisateur peut arrêter une mission en cours.

Le schéma contient encore des tables `agent_runs` et `agent_specs`, héritées d'un framework retiré (voir `docs/ARCHITECTURE.md`). Il faut évaluer leur réutilisation avant d'en créer de nouvelles.

## 6. Lots de travail

| WP | Sujet | Statut |
|---|---|---|
| 00 | Socle : clé locale, routage Claude par tâche, effort, lecture des blocs `thinking` | fait |
| 01 | ID du workspace Anthropic et test réel de bout en bout | bloqué, en attente du propriétaire |
| 02 | Journal d'usage et budgets | plafond fait ; persistance en base et panneau Réglages à faire |
| 03 | Tâche `extraction` sur Haiku pour l'analyse de brief, avec sortie structurée | ready-for-agent |
| 04 | Cache des prompts système et des outils | ready-for-agent |
| 05 | Orchestrateur de missions et agents (§5) | needs-triage |
| 06 | Batch API pour le rapport hebdo et la requalification en masse | needs-triage |
| 07 | Escalade vers Opus et gestion des refus (`stop_reason: refusal`) | needs-triage |
| 08 | Passer le chemin Anthropic sur le SDK officiel `@anthropic-ai/sdk` | needs-triage |

## 7. Réponses du propriétaire (2026-10-30)

- **RGPD :** validé. Les données candidats peuvent être traitées par Claude.
- **Budget :** de 20 à 30 € par mois. L'objectif est une démo utilisable avec toutes les fonctionnalités.
- **Démo publique :** les clés Anthropic seront posées sur l'hébergeur.

### Le budget est-il tenable ?

Estimations par appel, à confirmer avec le journal d'usage (WP 01) :

| Action | Modèle | Coût estimé |
|---|---|---|
| Classer une réponse | Haiku | < 0,001 $ |
| Message de chat ou analyse de brief | Sonnet, effort low | ≈ 0,01 à 0,03 $ |
| Message d'approche | Sonnet, effort medium | ≈ 0,02 $ |
| Lancement de l'agent de sourcing (jusqu'à 6 tours) | Sonnet, effort medium | ≈ 0,15 à 0,30 $ |

Avec 30 $ par mois, on peut faire par exemple 60 lancements de sourcing, 400 messages d'approche, 300 échanges de chat et des milliers de classifications. Le budget suffit pour préparer et jouer une démo.

### Garde-fous en place

- **Plafond dans l'app** (`src/lib/ai/usage.ts`) : 30 $ par mois et 6 $ par jour par défaut (`AI_MONTHLY_BUDGET_USD`, `AI_DAILY_BUDGET_USD`). Au-delà, chaque surface bascule sur son repli sans IA. Les compteurs vivent en mémoire et repartent de zéro au redémarrage.
- **Plafond ferme :** une limite de dépense sur le workspace dans la Console Anthropic. C'est au propriétaire de la poser, car la clé n'a pas les droits d'administration.

## 8. Questions encore ouvertes

1. **ID du workspace Anthropic.** La clé fournie n'est rattachée à aucun workspace. L'API exige l'en-tête `anthropic-workspace-id`, et la clé n'a pas le droit de lister les workspaces. Il faut l'ID `wrkspc_…`, visible dans la Console, ou une clé rattachée à un workspace.
2. **Limite de dépense dans la Console** sur ce workspace, recommandée à 30 $ par mois.
