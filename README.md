# YouVid (serveur local)

Un répertoire de vidéos au style YouTube.

## Lancer en local
1. Installe Node.js (>= 18).
2. Ouvre un terminal dans ce dossier et exécute :
   ```bash
   npm install
   npm start
   ```
3. Ouvre http://localhost:5173

Toutes les données (utilisateurs, vidéos, likes, vues, commentaires, abonnements, notifications) sont stockées en JSON dans le dossier **/save** à la racine.

## Structure
- `public/` : frontend statique (index.html, style.css, app.js, assets/)
- `server.js` : serveur Express + API REST
- `save/` : fichiers de données persistants (JSON)

## Notes
- Auth simple sans session : le client garde l'utilisateur courant dans `localStorage` uniquement pour la session. Les données, elles, sont persistées côté serveur dans `/save`.
- Lors de la première exécution, quelques vidéos et utilisateurs de démonstration sont injectés.
