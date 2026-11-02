# 02 — Libellés et définitions des métriques

Status: resolved
Blocked by: —
Spec: ../spec.md

## Critères d'acceptation

§2. Chaque KPI nomme sa base (envois réels / simulés / étape atteinte). Un 0 dû au mode démo le dit. « Canonical » disparaît. Le compteur d'intégrations est identique dans la sidebar et dans Settings ; « Mock » et « Connected » ne cohabitent plus sur une même carte.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

## Resolution (2026-11-02, commit 7bd03fba)

- Home and Exec KPIs name their basis (real sends, sourced pool, campaign timing). With no real send, rates show "—" and say "No real send yet · N simulated"; TTFI appears only once a real interview exists.
- "Canonical" is gone from Exec. One `integrationCounts` helper feeds the sidebar, Settings and the home strip ("0/6 live"); cards show one state label (Live, Simulated, Degraded, Error, Not configured, Concept).
