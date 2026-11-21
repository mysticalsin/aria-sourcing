# 01 — La conversation LinkedIn reste liée à un ancien candidat

Status: wontfix (LinkedIn bridge removed, 2026-11-20; conversation sync no longer exists)
Found: 2026-11-09 (tournage de la vidéo de démo, shift 465)

## Constat
Tony Walteur supprimé puis ré-ajouté (nouvel id `cand_mw9c9w7ea`). Le message
approuvé part bien (outbox `sent`, il réutilise la conversation existante),
mais l'onglet LinkedIn du candidat affiche « No conversation with Tony yet ».

## Cause
- `linkedin_bridge_contacts` garde une ligne par (compte, candidate_id) : les
  contacts des candidats supprimés restent, et un même profil présent dans deux
  campagnes a deux lignes avec le même `member_id`.
- `candidateMembers()` (`src/lib/linkedin-bridge/server.ts`) construit
  member_id -> candidate_id avec un `new Map` : le dernier gagne, ordre non défini.
- `storeConversations()` réécrit `candidate_id` de la conversation avec cette
  valeur à chaque synchro ; `linkCandidateConversations()` ne relie que les
  conversations `candidate_id is null`.
- Résultat : la conversation reste sur l'ancien id (vu en base : revenu à
  `cand_mw9206af9` après une synchro alors qu'on l'avait corrigé à la main).

## À faire
- Préférer un candidat existant dans `workspace_state` (et le plus récent)
  quand plusieurs contacts partagent un `member_id`, ou rattacher la
  conversation au contact de l'outbox qui vient d'envoyer.
- Supprimer / re-keyer les contacts quand un candidat disparaît du workspace.
- Côté lecture (`GET /api/linkedin/candidates`), retrouver la conversation par
  `member_id` du contact si `candidate_id` ne correspond pas.
- Test : deux contacts, même member_id, un candidat supprimé -> la conversation
  va au candidat vivant.

## Contournement appliqué en local (2026-11-09)
Suppression des 6 contacts orphelins (candidats absents du workspace) et
`update linkedin_bridge_conversations set candidate_id='cand_mw9c9w7ea'` pour
la conversation 991d1a79. Stable après plusieurs synchros.

## Comments
