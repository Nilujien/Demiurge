# Demiurge

Jeu web bac à sable : le doigt ou le curseur sculpte une île en relief, change les types de sol, fertilise, fait pleuvoir et pousser des forêts. Des villages s'y installent : leurs habitants abattent des arbres pour le bois, aplanissent et labourent la terre, sèment et récoltent des céréales. Rendu 3D isométrique en pixel art animé, WebGL2, sans moteur ni dépendance d'exécution.

**Jouer en ligne : https://nilujien.github.io/Demiurge/**

## Démarrer

Prérequis : Node.js 22.12 ou plus récent (exigé par Vitest ; Vite seul accepte 20.19).

```bash
npm install
npm run dev        # serveur de développement avec rechargement à chaud
npm run build      # vérification des types + build de production dans dist/
npm run preview    # sert dist/ localement
```

## Qualité

```bash
npm run check      # typecheck + lint + tests : à lancer avant chaque commit
npm test           # tests unitaires (Vitest)
npm run lint       # ESLint
npm run format     # Prettier
```

La CI GitHub (`.github/workflows/ci.yml`) exécute les mêmes vérifications et le build sur chaque push. Chaque push sur `main` publie aussi le jeu sur GitHub Pages (`.github/workflows/pages.yml`), après les mêmes vérifications.

## Commandes en jeu

| Action                      | Souris / clavier                            | Tactile                |
| --------------------------- | ------------------------------------------- | ---------------------- |
| Appliquer l'outil           | clic gauche                                 | un doigt               |
| Déplacer la vue             | clic droit, clic milieu ou Espace + glisser | deux doigts            |
| Zoom                        | molette, `+` `-`                            | pincer                 |
| Pivoter d'un quart de tour  | `Q` `E`                                     | boutons de l'interface |
| Outils                      | `1` à `9`                                   | boutons                |
| Taille du pinceau           | `[` `]`                                     | curseur                |
| Calque humidité / fertilité | `H`                                         | boutons                |
| Bulles d'activité           | `B`                                         | bouton                 |
| Pause                       | `P`                                         | bouton                 |
| Vitesse ×1 / ×2 / ×4        | `V`                                         | boutons                |
| Annuler / rétablir          | `Ctrl+Z` / `Ctrl+Maj+Z` ou `Ctrl+Y`         | boutons                |
| Sauvegarde rapide           | `Ctrl+S`                                    | bouton                 |
| Infos d'un village          | survoler son foyer ou ses maisons           | —                      |

Chaque monde a une graine, affichée dans le panneau et inscrite dans l'URL (`#seed=1789`) : le bouton « Lien » copie l'adresse pour partager l'île, et saisir une graine régénère le monde correspondant.

La partie est sauvegardée automatiquement dans le navigateur chaque minute et reprend à la visite suivante. « Sauvegarder » et « Charger » gèrent une sauvegarde rapide, « Exporter » et « Importer » un fichier `.demiurge`.

## Organisation

```
src/
  config.ts        constantes du monde et du moteur
  core/            maths, bruit, générateur aléatoire déterministe
  sim/             simulation pure (aucune dépendance au DOM ni à WebGL)
  tools/           pinceaux : effets d'un geste sur le monde
  render/          caméra iso, rendu WebGL2, palette, maillages, shaders GLSL
  input/           Pointer Events et clavier
  ui/              panneaux HTML et styles
  main.ts          assemblage et boucle de jeu
tests/             tests unitaires de la simulation et des outils
docs/              architecture et feuille de route
```

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les choix techniques et [docs/ROADMAP.md](docs/ROADMAP.md) pour la suite.
