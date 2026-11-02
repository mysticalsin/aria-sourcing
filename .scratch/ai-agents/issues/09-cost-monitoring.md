# 09 — Page « AI costs » : coût par activité

Status: resolved
Blocked by: —
Spec: ../spec.md

## Demande (propriétaire, 2026-11-02)

Un nouvel élément de menu qui montre ce que coûte l'app avec la clé d'API, en séparant les coûts par activité pour voir laquelle est la plus chère et pouvoir la justifier.

## Ce qui est livré

- **Activités** (`src/lib/ai/activities.ts`) : premiers contacts, relances, recontact du talent pool, réécritures, tri des réponses, réponses aux candidats, lecture de brief, chat, agent de sourcing. Chacune décrit ce qu'elle produit, son unité, le modèle et la raison de ce choix. Chaque appel à Claude porte son activité (`activity` dans `/api/hermes/chat` et la boucle d'outils) ; sans activité, celle de la tâche s'applique.
- **Registre** (`src/lib/ai/usage.ts`) : en plus du total par tâche × modèle, total du mois par activité (avec modèles utilisés), historique jour par jour sur 92 jours avec le détail par activité, historique mensuel sur 12 mois, projection fin de mois au rythme actuel. Un ancien fichier de registre est repris sous « Before activity tracking » pour que le total reste exact.
- **Page `/costs`** (menu Analyze → « AI costs », admin uniquement) : budget du mois et du jour, projection, nombre d'appels ; activité la plus chère avec sa justification ; classement des coûts par activité ; répartition Sonnet / Haiku ; tableau « What each activity buys » (résultats, coût par résultat, tokens, part du mois, combien le budget en paie) ; 30 derniers jours avec détail du jour sélectionné ; historique mensuel. La carte de Settings renvoie vers la page.
- **Tutoriel** : étape « What the AI costs » au chapitre 5.

## Limites

- Les montants sont estimés depuis les tokens renvoyés par Anthropic et la grille de prix ; la Console Anthropic reste la référence de facturation. Rapprocher les deux demanderait une clé Admin (API Usage & Cost), que la clé actuelle n'est pas.
- Le registre est par instance de serveur (fichier `AI_USAGE_FILE`).

## Vérification (2026-11-02)

- Missions rejouées avec Claude : relances 13 × 0,0044 $, premiers contacts 6 × 0,0041 $, réponses 6 × 0,0001 $ ; total du mois 0,165 $ dont 0,083 $ antérieurs au suivi par activité.
- Page capturée à 1440×900 et 390×844 : pas de débordement, menu sans défilement à 900 px.
- `tests/ai-provider.mts` : ventilation, valeur par défaut, total = somme des activités, série de 30 jours, projection, passage au mois suivant, ancien format.
