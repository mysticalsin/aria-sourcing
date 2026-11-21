# 07 — POC B3 : VM « bridge host »

Status: wontfix (LinkedIn bridge and extension removed, 2026-11-20; do not host a LinkedIn session)
Blocked by: 05
Spec: ../spec.md

## But
Répondre par oui ou non : des envois autonomes depuis une session LinkedIn synchronisée sur une VM fonctionnent-ils, et combien de temps le compte tient-il ?

## À faire
- La VM : un Chrome visible (Xvfb + noVNC, ou un bureau Linux) et un profil par utilisateur.
- L'extension, chargée et pointée vers l'origine HTTPS du serveur (permission optionnelle `https://*/*`, `aria-page.js` sur l'origine configurée).
- Chaque utilisateur se connecte lui-même par bureau à distance. On ne copie aucun cookie.
- Pas de proxy, pas de modification d'empreinte (décision du 2026-11-03).

## Registre à tenir
Une ligne par jour et par compte :
- envois mis en file, `sent`, `unknown`, refusés ;
- codes 401/403/429/999 ;
- checkpoint ;
- déconnexion.

## Critères d'acceptation
- Au moins 7 jours de mesures.
- Une conclusion écrite ici : possible ou non, et à quelles conditions.

## Comments
