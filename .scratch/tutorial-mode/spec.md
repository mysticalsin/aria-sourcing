# Mode tutoriel pas à pas

Demande du propriétaire (2026-11-02) : un mode tutoriel accessible depuis le menu, pour qu'une personne qui ne connaît pas l'application comprenne chaque partie et la teste facilement. En anglais comme le site, effort porté sur l'UX et la pédagogie. Il ne s'ouvre jamais tout seul, même à la première visite.

## Ce qui est livré

- **Entrées** : bouton « Tutorial » en bas de la sidebar, dans le menu mobile (☰) et dans la recherche (⌘K). Le tour d'accueil existant (3 écrans, première visite sur `/`) ne s'affiche pas quand le tutoriel est ouvert et mentionne le tutoriel sur son dernier écran.
- **Sommaire** : 5 chapitres, 22 étapes, environ 20 minutes. Progression par chapitre, bouton « Start », « Continue: chapter N » ou « Go through it again », « Start over ». Rappel du mode (démo fictive ou workspace live).
- **Étape** : titre, explication en 2–3 phrases, encadré « Try it » avec l'exercice et les libellés exacts des boutons. Quand l'app peut le constater, l'encadré passe à « Done » avec une phrase de confirmation, et « Skip » devient « Next ».
- **Guidage visuel** : la zone concernée est entourée d'un anneau (aucun fond bloquant, la page reste utilisable). « Show me where » y ramène. Si la personne est sur une autre page : « This step happens on … » avec « Take me there ».
- **Panneau** : ancré en bas à droite (desktop), il passe à gauche quand il couvrirait la zone ou qu'un tiroir/modale est ouvert. Réductible en pastille (avec ✓ quand l'exercice est fait). Sur téléphone : feuille basse limitée à 46 % de l'écran, qui se replie quand on touche la page.
- **Mémoire** : progression dans le navigateur (`localStorage` `aria:tutorial:v1`), jamais dans l'état du workspace.
- **Accessibilité** : région nommée « Tutorial », focus sur le titre à chaque changement d'étape, annonces `aria-live`, boutons icône avec libellé, mouvement réduit respecté.

## Chapitres

1. Find your way around : menu, mode (démo / dry-run), accueil.
2. Create a campaign : un rôle ou plusieurs, email → brief, création (détectée), lancement multi-rôles (détecté).
3. Find candidates : Run Aria (détecté), liste, profil + talent pool (détecté), onglets Applicants/Talent pool, pipeline.
4. Talk to candidates : base légale (détectée), approbation (détectée), relances (détectées), tri des réponses (détecté), calendrier.
5. Measure and stay in control : rapports, règles d'approbation, IA et coût, page carrières, fin.

## Décision liée (propriétaire, 2026-11-02)

Dans la démo synthétique, aucun brouillon n'était approuvable : les candidats sourcés n'avaient pas de base légale et le formulaire « Contact basis » n'existait qu'avec Supabase. Le formulaire est désormais disponible en démo. Enregistrer **seulement** une base légale (faits du profil inchangés) n'est pas de l'enrichissement payant : `candidateExclusionBlocker` suffit. Ajouter de nouveaux faits à un profil synthétique reste refusé, et un candidat exclu reste fermé.

## Fichiers

- `src/lib/tutorial/curriculum.ts` : contenu, cibles, détection, navigation (pur, testé).
- `src/components/tutorial/tutorial.tsx` : provider, panneau, anneau.
- Repères `data-tour="…"` sur les pages ciblées.
- `tests/tutorial-curriculum.mts` : les routes existent, chaque cible existe dans le code, navigation, détection, ouverture uniquement depuis le menu.
