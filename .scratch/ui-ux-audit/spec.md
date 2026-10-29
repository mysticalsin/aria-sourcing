# Audit UI/UX complet — ARIA (avant intégration IA)

Status: needs-triage
Date: 2026-10-29
Branche: mbe-branch (base eb3751f9)

## Méthode

- App lancée en démo synthétique (`next dev`, sans `.env.local`), donc aucune
  donnée ni envoi réel.
- 21 routes capturées en 1440×900 et 390×844 avec Playwright/Edge, tour
  d'accueil neutralisé (`hermes:onboarded:v1`).
- Pour chaque page, détection automatique des éléments qui dépassent la largeur
  de l'écran et relevé des erreurs console.
- Lecture du code pour chaque constat dont la cause n'était pas visible
  (métriques, login, navigation, typographie).

Les priorités : **P0** casse la page ou la confiance dans les chiffres. **P1**
ralentit le travail quotidien du recruteur. **P2** relève de la cohérence et de
la finition.

## Synthèse

L'app fait beaucoup et le fait de façon sûre, mais l'interface montre tout ce
que le système sait faire au lieu de ce que le recruteur doit faire maintenant.
On retrouve trois motifs partout :

1. **Les chiffres ne disent pas ce qu'ils comptent.** Le même indicateur vaut 0
   ou 35 selon l'écran, sans explication.
2. **Les outils passent avant le travail.** Dans Outreach et Replies, l'outil de
   démonstration occupe la place principale et la file de travail réelle vient
   en dessous.
3. **Le langage interne remonte jusqu'à l'écran** : TAnIA, TOFU/MOFU, Path A/B,
   Top Gun, Canonical, Mock, slogans marketing utilisés comme titres.

## P0 — cassé ou trompeur

### 1. Débordements horizontaux (mise en page cassée)

| Page | Viewport | Largeur réelle | Cause |
|---|---|---|---|
| `/` | 1440 | **3708 px** | rangée de pastilles « Integrations » `shrink-0 whitespace-nowrap` sans conteneur, plus la décoration `.orbital` (`-right-24`) |
| `/` | 390 | 3192 px | même cause |
| `/funnel` | 390 | 940 px | kanban `min-w-max` et table `min-w-[64rem]` sans conteneur à scroll ; en desktop le kanban est coupé à droite sans indication |
| `/candidates` | 390 | 573 px | table `min-w-[40rem]` sans vue mobile |
| `/settings` | 390 | 1023 px | colonne de navigation des réglages et contenu `min-w-0` à 1007 px |
| `/fleet`, `/skills` | 390 | 403 px | cartes `card-surface` débordent de 13 px ; onglets de Skills sans scroll |
| `/outreach` | 390 | 434 px | colonnes `space-y-6` à 418 px |

Sur l'accueil desktop, la page entière défile horizontalement : c'est le premier
écran vu après le login.

### 2. Métriques contradictoires

- Accueil : « Reply rate 0 % — across 0 contacts reached », « Interviews booked
  0 », « Time to first interview 325h ». Sur le même écran, les cartes campagne
  totalisent 35 contactés, 22 réponses et 5 entretiens, et le journal liste des
  entretiens réservés.
- Exec : le funnel du haut affiche Contacted 35 / Replied 22 / Interview 5, et
  les tuiles « Canonical » juste en dessous affichent 0 / 0 % / 0 %.
- **La cause n'est pas un bug de calcul.** `realFunnelFacts`
  (`src/lib/metrics.ts:153`) ne compte que les envois réels ; en démo, tout est
  simulé, donc 0. Le funnel, lui, compte les étapes du pipeline. Les deux
  définitions sont légitimes, mais aucune n'est nommée à l'écran. « Canonical »
  n'explique rien au lecteur.
- Intégrations : la sidebar dit « 5/6 », Settings dit « 5 connected · 12 not
  configured · of 17 total ». Une carte peut être à la fois « Connected » et
  « Mock ».

Correction attendue : chaque indicateur porte sa définition en clair (« envois
réels », « envois simulés », « étape atteinte »). Un 0 dû au mode démo le dit
(« 0 envoi réel — 35 simulés en démo »). « Time to first interview » ne s'affiche
pas quand il n'y a aucun entretien réel.

### 3. Login surchargé

Constat (`src/app/login/page.tsx`, 341 lignes) :

- Titre de 120 px en Times New Roman (la pile `--font-garamond` retombe sur
  Times sous Windows), en capitales, sur deux lignes.
- Vidéo de fond lue depuis un CloudFront tiers
  (`d8j0ntlcm91z4.cloudfront.net`) : poids, dépendance externe et fuite de
  l'adresse IP pour un outil RH. Bulle de verre et papillons par-dessus.
- Cinq blocs de texte empilés : titre, sous-titre, CTA, mention légale,
  crédit « Designed & built by ».
- Logo collé au bord supérieur (coupé en desktop).
- Bouton « Pause background motion » en bas à gauche, en capitales espacées.
- Le formulaire e-mail se trouve derrière un bouton « Sign in with email » en
  petites capitales à 50 % d'opacité, sous un CTA qui peut aussi lancer
  Microsoft. Le conteneur `h-screen overflow-hidden` risque de couper le
  formulaire sur un écran de portable de 768 px de haut (à vérifier en mode
  Supabase).

Direction proposée : un écran de connexion, pas une page d'accueil marketing.
Le logo, une phrase qui dit ce qu'est ARIA, le formulaire visible d'emblée (ou
le bouton Microsoft quand il est configuré), la mention « rien n'est envoyé sans
votre accord » en une ligne. Pas de vidéo, pas de crédit d'auteur sur l'écran
de connexion (il peut aller dans À propos ou le pied de la sidebar). Le slogan
« Human approval, machine speed » peut rester en sous-titre, pas comme élément
principal.

## P1 — friction dans le travail quotidien

### 4. Navigation et architecture de l'information

- **19 entrées de navigation** (`src/components/app/nav.ts`). Avec 900 px de
  haut, la sidebar s'arrête à « Winlog » : Reports, Sessions, Skills, Trust,
  Mailboxes et Settings sont sous la ligne de flottaison. Le bloc logo prend
  150 px.
- **Trois portes pour créer une campagne** : Intake (« coller un e-mail + JD »),
  Launch (« coller un brief multi-rôles ») et « New intake » dans Campaigns. Le
  recruteur doit savoir laquelle choisir.
- **Doublons de concepts** : Candidates, Applicants, #Vivier et Funnel montrent
  chacun une vue des mêmes personnes. Reports, Exec, Winlog, Skills et Trust
  sont cinq vues d'analyse.
- **Libellés incohérents** :
  - L'entrée « Mailboxes » ouvre une page titrée « An army of agents. One set
    of rules. » (eyebrow « Agent fleet »).
  - « Exec » et « Winlog » sont du jargon.
  - « #Vivier » est en français avec un dièse, dans une interface en anglais.
- La sidebar affiche « Created by Tony Walteur » et « Agentic sourcing
  platform » sous le logo, dans chaque écran.

Proposition à valider (voir Décisions) : regrouper autour du parcours du
recruteur.

```
Aujourd'hui      Accueil (file d'actions)
Recruter         Campagnes (+ « Nouvelle campagne » unique : un ou plusieurs rôles)
                 Candidats (vues : tous / candidatures / vivier)
                 Pipeline (ex-Funnel)
Échanger         Messages à valider (ex-Outreach)
                 Réponses
                 Agenda
Piloter          Rapports (Exec + Reports + Winlog + Trust/ROI en onglets)
Système          Boîtes d'envoi, Compétences (Skills), Historique (Sessions), Réglages
```

### 5. Les files de travail d'abord

- **Outreach** :
  - Le composeur « Draft a message in seconds » occupe le haut de la page.
  - Les 17 brouillons sont tous dépliés et éditables, soit 14 300 px de haut.
  - Une pastille de « personnalisation » flotte, en double, au-dessus de la
    première carte.
  - Une date d'attente en rouge (« waiting Jun 25, 2026 ») apparaît sur des
    données de démo vieilles de 4 mois.

  Attendu : la file en premier, une ligne par brouillon (candidat, sujet,
  canal, ancienneté), dépliage au clic, approbation au clavier. Le composeur
  passe dans un tiroir « Nouveau message ».
- **Replies** : « Paste reply to classify » (outil de démo) passe avant le flux
  de réponses à traiter (6 en retard sur SLA). Il faut inverser l'ordre et
  ranger l'outil derrière un bouton.
- **Accueil** :
  - Deux blocs « Command center » à la suite, tous deux annonçant « 17 messages
    are waiting for your approval », et deux boutons « Review outreach ».
  - « Always sourcing. » est présenté comme un bouton.
  - Le graphique « Conversion funnel » reste une boîte grise vide.

  Attendu : un seul en-tête, une seule action principale, une file « à faire »
  en haut.

### 6. Table Candidats

- Seulement 4 lignes visibles en 1440×900, avec 95 px de haut par ligne.
- La colonne Campagne et la colonne Next action passent sur 3 lignes.
- La source est affichée trois fois (pastille « Referral » + texte « GitHub » +
  pastille « GitHub ») et la pastille « Synthetic » apparaît sur chaque ligne
  (déjà indiqué dans la barre du haut).
- Ordre déroutant : stage « Booked » avec next action « Record contact basis ».
- En mobile, les filtres prennent tout le premier écran, puis la table déborde.

Attendu :
- Une ligne compacte d'environ 56 px, avec la source en une seule pastille.
- Le mode démo signalé une seule fois, pas sur chaque ligne.
- Des filtres repliables en mobile, et des cartes à la place de la table sous
  640 px.

### 7. Tour d'accueil

Le modal « Welcome to Aria » s'affiche sur **chaque page** tant qu'il n'a pas
été fermé : il bloque Campaigns ou Candidates pour quelqu'un qui arrive par un
lien direct. Attendu : il ne s'ouvre que sur l'accueil, à la première connexion.

## P2 — cohérence et finition

### 8. Vocabulaire

- Il faut une seule échelle de notation. Aujourd'hui coexistent Top Gun /
  A Player / B Player / C / D (Applicants, Vivier, Funnel), étoiles plus score
  sur 100 (Candidates) et « 75 match » (Outreach).
- Jargon interne à retirer :
  - Path A/B (Applicants) ;
  - TAnIA, Pre-stage I, Stage I · TOFU, Stage II · MOFU (Funnel) ;
  - Canonical (Exec) ;
  - « Silver medalist », « The gold we didn't lose » (Vivier).
- Rôle répété dans Applicants : « Senior Backend Engineer · Senior Backend
  Engineer ».
- Les slogans servent de titres de page : « Human approval. Machine speed. »
  (Outreach, et répété dans le panneau Guardrails), « An army of agents… »
  (Fleet), « Sourcing war room » (Launch), « Trust & ROI Proof Center ». Le
  titre doit nommer la page.
- Numérotation sans séquence : « 04 Connections » est le premier onglet des
  réglages, « 01: Inbound brief » est seul sur Intake.
- Intégrations : titres tronqués (« Email Inbox / O… », « Resume Matc… »),
  boutons sur deux lignes (« Setup / guide », « Test / connection »).
- Langue : l'interface est en anglais, sauf « #Vivier ». Il faut choisir (voir
  Décisions).

### 9. Système visuel

- **Typographie dépendante de l'OS** :
  - Corps en Calibri, donc en Carlito ou en Avenir selon la machine.
  - Titres de login en Times sous Windows.
  - Aucune police n'est servie par l'app (choix documenté dans
    `globals.css:44` pour éviter `next/font/google` au build).

  Recommandation : auto-héberger une famille (fichiers `woff2` dans `public/`)
  pour un rendu identique sur toutes les machines, ce qui reste compatible avec
  la contrainte de build.
- **Étiquettes en capitales espacées au-dessus de chaque bloc** (« COMMAND
  CENTER », « TALENT POOL », « PIPELINE », « PRIORITY QUEUE », « AUDIT
  TRAIL »…). Elles répètent souvent le titre juste en dessous. Il faut les
  retirer quand elles n'ajoutent rien.
- **Violet partout** : nav active en dégradé, boutons primaires, pastilles,
  barres, badges, bulles décoratives. Le violet ne signale plus l'action
  principale. Réserver la couleur pleine à une action par écran et aux états.
- **Badges de mode en double** : « Approval required » et « Synthetic demo »
  dans la topbar, « Dry-run mode enabled » en bas de sidebar, « Dry-run ·
  nothing sent » dans l'en-tête de page, « Demo data - synthetic » en bandeau
  (Exec), « Synthetic » sur chaque ligne de Candidates. Un seul indicateur
  global suffit.
- Cartes en grille de taille égale pour des contenus de poids très différent
  (KPI d'Exec, Fleet, Vivier).

### 10. Page carrières (publique)

- En démo, `/careers` répond 503 et le candidat voit un bandeau rouge :
  « Careers offline. Please retry before treating this as no open roles. ».
  C'est une phrase pour l'opérateur, pas pour un candidat.
- L'en-tête est centré sur 1100 px alors que la fenêtre de chat va de bord à
  bord : les deux ne sont pas alignés.

Attendu :
- En démo, des postes fictifs pour que le parcours soit démontrable.
- Hors ligne, un message pour le candidat : « Les candidatures sont fermées
  pour le moment. Revenez plus tard ou écrivez à … ».

## Ordre de traitement proposé

| Lot | Contenu | Prio | Dépend de |
|---|---|---|---|
| 01 | Débordements desktop/mobile | P0 | — |
| 02 | Libellés et définitions des métriques | P0 | — |
| 03 | Nouveau login | P0 | décision langue |
| 04 | Navigation et fusion des entrées de création | P1 | décision IA |
| 05 | Files de travail d'abord (Outreach, Replies, Accueil) | P1 | 02 |
| 06 | Table Candidats compacte + mobile | P1 | 01 |
| 07 | Tour d'accueil limité à l'accueil | P1 | — |
| 08 | Vocabulaire et échelle de notation unique | P2 | décision notation |
| 09 | Système visuel (police servie, couleur, badges de mode) | P2 | 03 |
| 10 | Page carrières en démo et hors ligne | P2 | — |

Chaque lot passe la porte de test (`npm run typecheck && npm run
typecheck:tests && npm test`) et une nouvelle capture des 21 routes à 1440 et
390 px. Critère : aucune page plus large que le viewport.

## Décisions (prises le 2026-10-29, ne pas rediscuter)

1. **Interface en anglais partout.** « #Vivier » devient « Talent pool ».
2. **Navigation regroupée comme au §4**, avec Intake et Launch fusionnés en une
   seule « New campaign ». Les anciennes URL redirigent.
3. **Score /100 seul** pour noter les candidats. Top Gun / A Player / lettres /
   étoiles disparaissent de l'écran.
4. **Plus de crédit personnel.** « Designed & built by Tony Walteur » et
   « Created by Tony Walteur » sont retirés et remplacés par une mention de
   Mantu Group.
