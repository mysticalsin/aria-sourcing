# Agents autonomes : un conteneur qui fait tourner des tâches planifiées

Date : 2026-11-09 · Branche : mbe-branch · Statut : décisions prises (2026-11-09, §4bis), ADR 0002 acceptée, rien n'est construit

Demande du propriétaire (2026-11-09) : ajouter à l'infra un conteneur qui fait
tourner des agents sur la clé API Claude, pour des tâches autonomes :

1. Lire la boîte mail de plusieurs managers et créer des campagnes (idée, pas
   maintenant).
2. Sourcer automatiquement les candidats des campagnes en cours.
3. Choisir les 3 meilleurs candidats selon le matching et leur envoyer un
   message LinkedIn automatiquement.
4. Notifier par email le ou les managers de la campagne que ces candidats ont
   été contactés (plus tard).

À terme : des VM qui font tourner l'application et l'extension connectée.

Cette étude part du code tel qu'il est au commit 6c778ea3.

## 1. Résumé

- Les tâches 2 et 4 sont faisables sans débat. Leurs briques existent déjà
  (sourcing côté serveur, scoring, envoi d'email). Il manque un exécuteur côté
  serveur et une identité « agent ».
- La tâche 1 est faisable plus tard. Chaque manager connecte sa propre boîte
  Microsoft 365 : le scope `Mail.Read` délégué est déjà demandé
  (`src/lib/email-oauth.ts:214`). L'analyse d'un email en fiche de poste existe
  déjà (`src/lib/ai/intake.ts`).
- La tâche 3 se heurte à trois règles en place. Elles ne sont pas techniques :
  ce sont des décisions à reprendre explicitement (§4).
  - Le pont LinkedIn interdit par construction qu'un agent écrive dans
    l'outbox. Un test le vérifie (`tests/linkedin-bridge.mts:549-567`).
  - L'ADR 0001 exclut un worker séparé.
  - Les CGU LinkedIn interdisent l'envoi automatisé.
- Le plus gros chantier n'est pas le conteneur. Aujourd'hui, l'état d'un
  workspace (campagnes, candidats, brouillons) est un document JSON
  (`workspace_state`) écrit par le store React du navigateur
  (`src/lib/store.ts`, `"use client"`). Un agent sans navigateur ne peut pas
  rédiger ni approuver un message tant que ces actions vivent dans le store.
- Je déconseille la VM avec Chrome, l'extension et la session LinkedIn d'un
  recruteur. C'est le modèle HeyReach que `docs/linkedin-bridge.md` décrit
  comme un signal d'automatisation pour LinkedIn : session déplacée vers une IP
  de datacenter, activité 24 h/24. Il fait aussi sortir la session LinkedIn
  personnelle d'un salarié sur un serveur. Recommandation : une VM pour l'app
  et les agents, mais l'envoi LinkedIn reste dans le Chrome du recruteur (§5).

## 2. Ce qui existe déjà (vérifié dans le code)

| Brique | Où | Exécution aujourd'hui |
|---|---|---|
| Moteur de missions : étapes, fan-out, concurrence, délai, annulation, repli | `src/lib/agents/mission.ts` | TypeScript pur, réutilisable côté serveur |
| Mission « Run Aria » : sourcing, puis 6 brouillons | `src/lib/agents/campaign-mission.ts` | dans le navigateur, sur les actions du store ; fermer l'onglet l'arrête |
| Sourcing de campagne durable : WebSearch LinkedIn via Claude, puis GitHub | `src/lib/sourcing/unified-*`, `/api/source/campaign` | côté serveur, étapes persistées (`campaign_sourcing_jobs`), mais **avancées par la page** (`action: "advance"` avec la session de l'utilisateur) |
| Scoring / matching | `src/lib/scoring.ts` (`scoreCandidate`) | déterministe, appelé au moment de l'enregistrement |
| Rédaction d'un message d'approche (Sonnet, gabarit en repli) | `generateOutreachLive` dans `src/lib/store.ts` → `/api/hermes/chat` | dans le navigateur |
| Approbation, puis envoi LinkedIn | `approveOutreach` (store), `src/components/linkedin/outreach-send.ts`, `/api/linkedin/outbox` | clic humain ; la route exige un cookie de session et la même origine |
| Envoi LinkedIn effectif | extension `extensions/linkedin-bridge` | Chrome du recruteur, sur sa session et son IP, avec un rythme imposé (90 s entre deux envois, 40 par 24 h, 15 invitations par jour) |
| Envoi d'email | `src/lib/email-send.ts`, `email-oauth.ts` (Gmail, Graph `sendMail`) | côté serveur, depuis la boîte connectée d'un utilisateur |
| Cron | `/api/cron/dispatch-outbound` (Bearer `CRON_SECRET`) | aucun planificateur ne l'appelle dans `docker-compose.yml` |
| Budget IA | `src/lib/ai/usage.ts` (30 $/mois, 6 $/jour par défaut) | côté serveur |
| Tables héritées | `agent_specs`, `agent_seats`, `agent_conversations` (baseline) | inutilisées |

Faits qui pèsent sur la conception :

- Un 1er degré seulement reçoit un message LinkedIn. Pour les autres, seule une
  invitation avec une note de 300 caractères au plus est possible. Les 3
  meilleurs candidats d'une campagne sourcée ne sont presque jamais des
  connexions. En pratique, « envoyer un message » veut donc dire « inviter
  avec une note », dans la limite de 15 invitations par jour et 80 par
  semaine.
- Le pont est personnel : une connexion LinkedIn appartient à un couple
  (workspace, utilisateur). Un agent doit donc agir **au nom d'un recruteur
  précis**, par exemple le propriétaire de la campagne, avec son compte
  LinkedIn.
- Le mode confidentialité masque les candidats « Sourced » jusqu'à un
  « Reveal » journalisé. Un envoi par agent est donc une révélation faite par
  l'agent, et elle doit être journalisée comme telle.

## 3. Architecture proposée

### 3.1 Un conteneur `agents`, même image, sans accès à la base

```
                 docker compose (une VM)
┌───────────────────────────────────────────────────────────────┐
│ agents  (même image que app, entrypoint node agents/runner)   │
│  - planificateur : toutes les N min, missions dues            │
│  - moteur de missions (src/lib/agents/mission.ts)             │
│  - secrets : ANTHROPIC_API_KEY, AGENT_TOKEN                   │
│  - aucune clé de base de données                              │
│        │ HTTP interne, Bearer AGENT_TOKEN                     │
│        ▼                                                      │
│ app  /api/agent/*  : routes étroites, une par action          │
│  - authentifie l'agent (hash du jeton, comme le pairing)      │
│  - agit pour le compte d'un utilisateur (on_behalf_of)        │
│  - mêmes contrôles : rôle, quotas, budget IA, suppression,    │
│    confidentialité, idempotence, journal                      │
│        │                                                      │
│ db / auth / rest / gateway  (inchangés)                       │
└───────────────────────────────────────────────────────────────┘
          ▲ poll toutes les minutes (inchangé)
   Chrome du recruteur + extension ARIA → LinkedIn
```

Pourquoi ce découpage :

- **Le conteneur ne porte que la planification et la clé Claude.** Toute
  écriture passe par l'app, donc par les garde-fous existants : quotas,
  suppression, idempotence, RLS via les RPC. Un jeton d'agent volé ne permet
  que les actions de `/api/agent/*`, comme le jeton de l'extension ne permet
  que sa liste blanche.
- **Même image.** Le conteneur réutilise `scoring.ts`, `mission.ts` et les
  contrats Zod sans dupliquer de code. Il n'y a qu'un build. Sur une VM, c'est
  un service de plus dans le même compose.
- **Le déterministe d'abord** (règle de `.scratch/ai-agents/spec.md` §3).
  Claude ne choisit pas qui contacter : le scoring le fait. Claude intervient
  pour le langage : requêtes de sourcing (WebSearch), rédaction, et plus tard
  la lecture des emails. Une boucle d'outils libre n'a d'intérêt que pour la
  tâche 1.
- **SDK.** On utilise `@anthropic-ai/sdk` (issue 08 de ai-agents), avec le tool
  runner pour la seule boucle d'outils. Je n'utilise pas le Claude Agent SDK
  (le harnais Claude Code), car il apporte un shell et un système de fichiers
  dont ces tâches n'ont pas besoin, et ce serait une surface de risque en
  plus.

Variante plus légère, conforme à la lettre de l'ADR 0001 : un conteneur cron
minimal (`curl` toutes les N minutes sur `/api/cron/agents`, avec
`CRON_SECRET`), les missions tournant dans le processus Next. Elle coûte moins
au départ. Elle a deux défauts : une mission longue (sourcing, puis 3
rédactions) occupe le serveur web, et un redéploiement de l'app la coupe. Je
recommande le conteneur `agents`, avec une nouvelle ADR (§4, décision A).

### 3.2 Identité et traçabilité

- Une **délégation** par recruteur : « l'agent peut agir pour moi sur ces
  campagnes ». Elle est créée par l'utilisateur dans Réglages et révocable en
  un clic. Elle est stockée avec le hash du jeton, sa portée (sourcer, rédiger,
  mettre en file LinkedIn, envoyer un email) et des plafonds propres.
- Chaque action porte `actor = agent`, `on_behalf_of = <user>`, `mission_id`.
  L'historique du candidat affiche « Contacté par l'agent pour Michael ».
- Un journal de mission persistant : une table `agent_missions` (nouvelle) ou
  la reprise de `agent_specs`/`agent_seats` après examen. Il contient les
  étapes, la durée, les tokens, le coût et les erreurs, jamais le contenu des
  candidats.

### 3.3 Les missions

**M2 : sourcing automatique** (déclencheur : planification par campagne,
par exemple chaque nuit)

1. Liste des campagnes `active` dont la délégation autorise le sourcing et
   dont le dernier run est plus vieux que la cadence choisie.
2. `start`, puis `advance` jusqu'au terminal, sur un équivalent agent de
   `/api/source/campaign`. Plan : WebSearch, puis GitHub, avec des limites
   basses (5 à 10 profils par source).
3. Le serveur score et dédoublonne, comme aujourd'hui, dans
   `unified-repository`.
4. Budget : environ 0,15 à 0,30 $ par run de sourcing
   (`.scratch/ai-agents/spec.md` §7). Avec 5 campagnes chaque nuit, cela fait
   environ 25 à 45 $ par mois, au-dessus du plafond actuel de 30 $. Il faut
   régler la cadence ou le plafond (décision D).

**M3 : top 3, rédaction, envoi LinkedIn** (déclencheur : fin de M2)

1. Choix déterministe : les 3 meilleurs scores parmi les candidats de la
   campagne qui sont tous éligibles :
   - pas encore contactés, sur aucun canal ;
   - pas de suppression, désinscription, ni « ne pas contacter » ;
   - pas effacés ;
   - URL LinkedIn connue ;
   - score au-dessus d'un seuil fixé par campagne ;
   - aucun bloqueur `candidateDraftBlocker`.
2. Rédaction : Sonnet, tâche `outreach`, côté serveur. Format invitation
   (≤ 300 caractères) si le candidat n'est pas une connexion, message sinon.
   La première vérification de relation passe par le pont et compte comme une
   vue de profil.
3. Envoi : dépend de la décision B (§4).
4. Les plafonds du pont s'appliquent tels quels. Avec 15 invitations par jour
   et par compte, 3 candidats sur 5 campagnes saturent le compte d'un seul
   recruteur.

**M4 : notification du manager** (plus tard ; déclencheur : envoi confirmé par
l'extension, pas la mise en file)

- Un email récapitulatif par campagne et par jour (pas un email par
  candidat). Il donne les noms, les scores, le canal, et un lien vers la
  campagne.
- L'expéditeur est la boîte connectée du recruteur (`email-send.ts`). Il
  manque une donnée : le modèle n'a pas de champ « managers de la campagne »,
  il faut l'ajouter.
- On n'envoie que quand l'extension a confirmé l'envoi. Un envoi `unknown`
  n'est jamais annoncé comme fait.

**M1 : boîte mail vers campagne** (idée, pas maintenant)

- Chaque manager connecte sa boîte Microsoft 365 en délégué : la lecture se
  fait sur sa boîte, avec son consentement. Il n'y a pas de permission
  applicative sur tout le tenant, qui demanderait l'accord de la DSI et une
  `ApplicationAccessPolicy`.
- Haiku, avec sortie structurée, filtre les emails « besoin de recrutement »,
  puis `parseIntakeLive` les transforme en fiche.
- Le résultat est une campagne en **brouillon**, que le recruteur relit avant
  qu'un sourcing ne parte. C'est la règle actuelle : créer une campagne ne
  lance pas de sourcing payant.
- Risque principal : l'injection de prompt dans un email entrant.
  `detectInjection` existe déjà. L'agent de lecture n'a aucun outil d'action :
  il produit une fiche et c'est tout.

## 4. Décisions à prendre par le propriétaire

**A. Un conteneur worker, contre l'ADR 0001.** Cette ADR dit : « Do not add
[...] a separate AI server, or worker orchestration for this slice. » La
demande la contredit. Elle se justifie, car il faut des missions qui survivent
à la fermeture d'un onglet. Proposition : ADR 0002 « agents runner »,
recommandée.

**B. L'envoi LinkedIn sans clic.** C'est la décision qui compte. Trois niveaux :

| Niveau | Ce que fait l'agent | Qui envoie | Risque compte LinkedIn | Écart avec les règles actuelles |
|---|---|---|---|---|
| B1 (recommandé pour démarrer) | source, choisit le top 3, rédige, puis notifie le recruteur : « 3 messages prêts » | le recruteur, un clic sur « Approve & send » (existe déjà) | celui d'aujourd'hui | aucun |
| B2 | idem, puis met en file **dans l'outbox du recruteur** sous une approbation permanente qu'il a signée pour cette campagne (texte-type validé, seuil, 3 au plus par campagne et par jour) | l'extension, dans **son** Chrome, sur sa session et son IP, quand il est ouvert | plus élevé : envoi automatisé, interdit par les CGU LinkedIn | inverse l'invariant « a message leaves only when you click » ; il faut retirer ou modifier le test `tests/linkedin-bridge.mts:549-567`, ainsi que `humanApprovalGate` |
| B3 | idem B2, mais Chrome, l'extension et la session tournent sur une VM | la VM, 24 h/24 | élevé : IP de datacenter, session déplacée, rythme non humain (le cas HeyReach) | B2, plus une session LinkedIn personnelle stockée sur un serveur |

Recommandation : livrer B1 tout de suite. Il donne 90 % de la valeur : le
recruteur reçoit chaque matin « 3 candidats prêts pour la campagne X » et
valide en 10 secondes. Passer à B2 seulement après une décision écrite du
propriétaire, une ADR et l'accord de chaque recruteur dont le compte est
utilisé. Ne pas faire B3.

À noter : l'envoi automatisé à grande échelle passe officiellement par
LinkedIn (programme partenaire Recruiter System Connect, ou les outils
Recruiter qu'Amaris paie peut-être déjà). C'est une démarche commerciale avec
LinkedIn, pas du code.

**C. Qui est l'expéditeur.** Le propriétaire de la campagne, ou un recruteur
choisi par campagne ? Avec plusieurs managers par campagne, il faut savoir de
quel compte LinkedIn part le message.

**D. Budget.** Le plafond actuel de 30 $/mois ne suffit pas pour un sourcing
nocturne de plus de 5 campagnes. Faut-il un plafond séparé pour les agents ?

**E. Base légale RGPD des contacts automatiques.** L'intérêt légitime est
documenté pour un contact décidé par un humain. Un contact décidé par un
algorithme relève de l'information due aux candidats (article 14) et du
registre de traitements. À valider avec le DPO d'Amaris avant B2.

## 4bis. Réponses du propriétaire (2026-11-09)

- **A :** accordé, ADR 0002 (`docs/adr/0002-agents-runner.md`).
- **B :** on teste l'envoi automatique (B2, puis B3). C'est un POC : on veut
  savoir si c'est possible. Le propriétaire connaît les risques.
- **C :** l'expéditeur est le propriétaire de la campagne, avec son compte
  LinkedIn synchronisé. Chaque utilisateur de la plateforme synchronise son
  propre compte. C'est déjà le cas : un appairage par couple (workspace,
  utilisateur).
- **D :** le budget peut augmenter. Les agents auront leurs propres plafonds.
- **E (cible) :** l'app et les agents tournent sur un serveur. La VM sert
  à l'envoi automatique, avec les sessions LinkedIn synchronisées des
  utilisateurs (B3).
  - Contrainte retenue : chaque utilisateur se connecte lui-même dans le
    Chrome de la VM, par bureau à distance. On ne copie aucun cookie. Pas de
    proxy ni de maquillage d'empreinte (décision du 2026-11-03).
  - L'extension s'y prête déjà : elle ouvre elle-même un onglet
    `linkedin.com/messaging` épinglé (`background.js:179`) et interroge ARIA
    toutes les minutes (`chrome.alarms`). Il reste à la pointer vers l'origine
    HTTPS du serveur.
- **Confirmé (2026-11-09) :** pas de copie de cookie de session, et pas de
  maquillage pour LinkedIn (proxy, empreinte, délais aléatoires). Le POC
  mesure ce qui se passe quand on ne cache rien.
- **Toujours ouvert :** la base légale RGPD des contacts décidés par
  l'algorithme. À valider avec le DPO avant un usage sur de vrais candidats
  hors POC. Cela ne bloque pas le POC.

## 5. La cible : un serveur et une VM d'envoi

- **Serveur :** le compose actuel, plus le service `agents` (même image).
  - Les secrets viennent d'un coffre.
  - HTTPS au gateway.
  - Sauvegardes de `db_data` et `app_config`.
  - Prérequis : une configuration séparée. Le compose actuel contient les JWT
    publics de démo et un admin seedé, que l'ADR 0001 exclut de tout usage
    non local.
- **VM « bridge host » (POC B3) :**
  - Un Chrome visible (bureau Linux, ou Xvfb + noVNC).
  - Un profil Chrome par utilisateur ARIA, chacun avec l'extension appairée
    à son compte ARIA et pointée vers l'origine HTTPS du serveur.
  - L'utilisateur se connecte lui-même à LinkedIn par bureau à distance et
    gère lui-même un éventuel checkpoint de sécurité.
  - La VM ne reçoit aucun secret ARIA en dehors des jetons d'appairage. Le
    serveur reste le cerveau, l'extension la main.
- **Ce que le POC mesure :**
  - si la session tient dans la durée (jours avant déconnexion ou checkpoint) ;
  - le taux de livraison (`sent`, `unknown`, refus) ;
  - les codes 429/999 ;
  - le délai entre la mise en file et l'envoi.
  - L'issue 07 tient ce registre.

## 6. Lots de travail (un fichier par lot dans `issues/`)

| # | Lot | Dépend de | Taille |
|---|---|---|---|
| 01 | Rédaction d'un message d'approche côté serveur, hors du store | aucun | L |
| 02 | Identité agent : délégation, jeton hashé, `requireAgent`, attribution | aucun | M |
| 03 | Routes `/api/agent/*` | 01, 02 | M |
| 04 | Service `agents` dans le compose, planificateur, journal `agent_missions`, plafonds IA propres | 03 | M |
| 05 | Approbation permanente par campagne, file LinkedIn par l'agent, test d'invariant du pont revu (B2) | 02 | M |
| 06 | Missions M2 (sourcing nocturne) et M3 (top 3, puis mise en file) | 04, 05 | M |
| 07 | POC B3 : VM « bridge host » (Chrome visible, un profil par utilisateur, bureau à distance) et mesures | 05 | M |
| 08 | M4 : email récapitulatif aux managers après envoi confirmé | 06 | S |
| 09 | M1 : boîtes mail des managers, puis campagnes en brouillon (plus tard) | 02 | L |
| 10 | Configuration serveur : secrets, HTTPS, sauvegardes, origine de l'extension | 04 | M |

Ordre : 01 et 02 en parallèle, puis 03, 05, 04, puis 06. On obtient un
envoi automatique depuis le Chrome du propriétaire (B2). Puis 07 : le même
envoi depuis la VM (B3).

## 7. Questions ouvertes

1. RGPD : base légale des contacts automatiques (DPO).
2. Cadence : sourcing nocturne, ou à chaque changement de brief ?
3. Seuil de score minimal pour qu'un candidat entre dans le top 3, par
   campagne ou global.
4. Une campagne sans recruteur dont l'extension est connectée : on saute, ou
   on notifie seulement ?
