# CheckGames

Le jeu de cartes du Cameroun, en temps réel, chacun sur son téléphone (2 à 5 joueurs).

## Lancer sur ton ordinateur

1. Installe [Node.js](https://nodejs.org) (version 18 ou plus).
2. Dans ce dossier :
   ```
   npm install
   npm start
   ```
3. Ouvre http://localhost:3000. Pour tester à plusieurs, ouvre plusieurs onglets, ou connecte les téléphones au même Wi-Fi et va sur `http://<adresse-IP-de-ton-ordi>:3000`.

Tests : `npm test` (règles + parties simulées à 2, 3 et 5 joueurs).

## Mettre en ligne gratuitement (Render)

1. Crée un compte sur https://github.com et un nouveau dépôt (par exemple `checkgames`).
2. Envoie ce dossier dans le dépôt (sans `node_modules`) :
   ```
   git init
   git add .
   git commit -m "CheckGames"
   git branch -M main
   git remote add origin https://github.com/<ton-pseudo>/checkgames.git
   git push -u origin main
   ```
3. Crée un compte sur https://render.com (connexion avec GitHub).
4. **New → Blueprint**, choisis ton dépôt : Render lit `render.yaml` et configure tout (offre gratuite).
   Ou bien **New → Web Service** avec : Build `npm install`, Start `npm start`, Instance `Free`.
5. Render te donne une adresse du type `https://checkgames.onrender.com`. Partage-la !

À savoir sur l'offre gratuite : après 15 minutes sans joueur, le serveur se met en veille. Le premier qui ouvre le lien attend environ une minute, ensuite tout est fluide. Les parties en cours sont gardées en mémoire : un redémarrage du serveur les efface.

## Règles appliquées

- Même couleur ou même valeur. À ton tour, tu joues **ou** tu pioches 1 carte (la pioche termine le tour).
- **7** : +2 au suivant. **Joker** : +4. Les pénalités se cumulent : n'importe quel 7 ou joker peut répondre. Sinon on pioche tout. On peut aussi choisir d'encaisser.
- **Joker** hors pénalité : rouge sur rouge, noir sur noir, ou sur n'importe quel autre joker (paquet de 52 cartes + 2 jokers).
- **As** : le suivant saute son tour (à 2 joueurs, on rejoue). À 2 joueurs, on ne peut pas finir sur un as.
- **J** : se pose sur tout (pas pour répondre à un 7/joker), sur un autre J aussi, et commande une couleur.
- **Check** : on ne le dit que quand il ne reste qu'une carte à jouer. Juste après avoir posé ton avant-dernière carte, appuie sur « Check ! » avant que le suivant joue. Sinon +1 carte. Ton nom s'entoure en vert chez tout le monde.
- Carte de départ : jamais un 7, un joker, un as ou un J.
- Banque vide : on garde la carte du dessus, on remélange le reste. S'il n'y a vraiment plus de cartes, le reste de la pénalité est annulé.
- Manche bloquée (plus rien à piocher et personne ne peut jouer pendant un tour complet) : celui qui a le moins de cartes gagne la manche.
- 3 à 8 cartes par joueur. Premier joueur au hasard, puis le gagnant de la manche précédente.
- Chrono de 30 s par tour : à la fin, pioche automatique. Un joueur déconnecté a 60 s pour revenir, ensuite ses tours sont joués automatiquement (pioche).
- Fin du match choisie au début : « premier à X victoires » ou « X manches ». Égalité : manche décisive.
- On ne rejoint une partie qu'entre deux manches. Si l'hôte part, le rôle passe au joueur suivant.
- L'hôte peut **recommencer la manche** (bouton ↻) : nouvelle distribution, scores inchangés.
- Bouton « Quitter » à tout moment : en pleine manche, les cartes du joueur retournent dans la banque et la partie continue. S'il ne reste qu'un joueur, retour au salon.

Couleurs : ♥ macabo rouge · ♣ arachide · ♦ biscuit carré · ♠ macabo noir.

## Fichiers

- `game.js` : le moteur de règles (c'est ici qu'on change une règle)
- `server.js` : le serveur temps réel (salles, chrono, reconnexion)
- `public/` : l'application (écrans, sons, cartes dessinées en SVG dans `cards.js`)
