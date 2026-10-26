# Architecture

## Principes

1. **La simulation est pure.** `src/sim` ne connaît ni le DOM ni WebGL. Elle se teste dans Node, pourra passer dans un Web Worker, et son état est sérialisable tel quel (tableaux typés).
2. **Déterminisme.** Tous les tirages passent par `Rng` (mulberry32) initialisé par la graine du monde ; les variations visuelles par cellule utilisent `hash2`, stable. Une même graine redonne le même monde, ce que vérifient les tests.
3. **Données en structure de tableaux.** `World` stocke chaque grandeur dans un `Float32Array` ou `Uint8Array` de n×n cellules. Boucles serrées sans allocation, transfert direct vers des textures GPU.
4. **Le rendu consomme, il ne décide pas.** La simulation lève des drapeaux (`Simulation.dirty`) ; `Renderer.sync` envoie au GPU uniquement ce qui a changé.
5. **Aucune dépendance d'exécution.** TypeScript compilé par Vite, WebGL2 natif. Les dépendances npm sont toutes des outils de développement.

## Flux d'une image

```
Input ──► Hud.state (outil, pinceau, calque)
  │
  ▼
main.ts : boucle requestAnimationFrame
  ├─ IsoCamera.update        matrices, accrochage aux pixels
  ├─ raycastTerrain           pointeur → point du relief
  ├─ applyTool                modifie World, lève les drapeaux
  ├─ Simulation.tick × k      pas fixe à SIM_HZ, découplé du rendu
  ├─ Simulation.updateFlow    réseau d'écoulement, au plus 4 fois/s
  ├─ Renderer.sync            maillages, textures d'état, instances d'arbres
  └─ Renderer.render          passe monde basse résolution → passe finale
```

## Simulation (`src/sim`)

Un pas (`Simulation.tick`) enchaîne :

1. **Fertilité** : diffusion lente entre voisins orthogonaux, légère décroissance.
2. **Météo** (`Weather.step`) : les nuages de pluie dérivent avec le vent et déposent leur eau sur les cellules qu'ils couvrent, puis se dissipent. L'outil Pluie ne mouille jamais le sol directement : il charge un nuage au-dessus du pinceau.
3. **Humidité** (`Hydrology.step`) : pluie de fond (majorée en altitude), ruissellement diffus vers les voisins plus bas proportionnel à la pente et au sol, recharge en bord d'eau, évaporation réduite par l'ombre de l'herbe et des arbres.
4. **Végétation** (`Ecology.stepVegetation`) : l'herbe tend vers fertilité × aptitude du sol × humidité ; les arbres poussent selon fertilité et humidité, se disséminent à partir des arbres matures voisins, et enrichissent le sol. Sur un champ, seules les céréales semées poussent, en puisant dans la fertilité.
5. **Populations** (`People.step`) : chaque habitant inactif choisit une tâche pour son village (chantier, récolte, abattage si le bois manque, semis, nouvelle parcelle, sinon flânerie), marche jusqu'à la cellule visée puis y travaille. Une parcelle est d'abord aplanie en terrasse (la cellule et ses voisines sont ramenées au niveau du champ contigu), puis labourée et semée. Chaque année, le village mange son grain et brûle un peu de bois ; il naît des enfants s'il reste du grain et de la place dans les maisons, on bâtit une maison quand le bois suffit, et un village prospère essaime un hameau plus loin. La famine et la vieillesse tuent ; un village vide disparaît et ses champs retournent à l'herbe. Les habitants ont leur propre `Rng`, dérivé de la graine.

Le **réseau d'écoulement** (`Hydrology.computeFlow`) est plus coûteux et recalculé à la demande :

- direction D8 : chaque cellule pointe vers la voisine de plus forte pente descendante, ou -1 pour une cuvette ;
- accumulation : les cellules sont parcourues de la plus haute à la plus basse, chacune transmet sa surface drainée (pondérée par le sol, le couvert et l'humidité) à sa voisine aval ;
- l'intensité de cours d'eau est un `smoothstep` de cette accumulation. Elle sature l'humidité des berges et dépose des alluvions.

Les paramètres sont regroupés en tête de module (`HYDRO`, `ECO`, `RAIN`, `PEOPLE`) et par sol dans `SOILS`.

## Rendu (`src/render`)

**Caméra** : orthographique, élévation 30° (losanges 2:1), rotation par quarts de tour animée, zoom par paliers en pixels par unité. La cible est accrochée à la grille des pixels basse résolution, ce qui supprime le grouillement en déplacement.

**Passe monde** dans un framebuffer basse résolution (couleur RGBA8 + profondeur 24 bits) :

| Mode `world.frag` | Géométrie            | Rôle                                                                 |
| ----------------- | -------------------- | -------------------------------------------------------------------- |
| 0                 | maillage n×n         | relief : sols, herbe, neige, falaises, cours d'eau, pinceau, calques |
| 1                 | tranches des 4 bords | strates du diorama                                                   |
| 2                 | plan d'eau           | profondeur, reflets, écume                                           |
| 3                 | tranches d'eau       | mer vue de côté                                                      |

Les arbres sont 3 maillages low-poly (feuillu, conifère, buisson) dessinés en instanciation ; le vent est appliqué dans le vertex shader. Le même programme dessine les accessoires : habitants (mains vides, chargés de bois ou de grain, positions interpolées entre deux pas de simulation et agrandis aux faibles zooms), maisons, nuages (transparence tramée) et gouttes de pluie (calculées sans état à partir du temps). Nuages et gouttes n'écrivent pas la profondeur, pour ne pas tracer de contours.

Deux textures n×n portent l'état par cellule :

| Texture    | R        | G           | B                | A        |
| ---------- | -------- | ----------- | ---------------- | -------- |
| `stateTex` | sol      | fertilité   | herbe            | altitude |
| `hydroTex` | humidité | cours d'eau | direction D8 + 1 | champ    |

Le canal champ vaut 0 hors champ, 1 pour une terre labourée, puis croît avec les céréales jusqu'à 255 (mûres) : `world.frag` y dessine sillons et rangées vertes, jaunissantes puis dorées.

**Passe finale** : agrandissement au plus proche voisin, contour sombre là où la profondeur saute, ciel en dégradé tramé.

**Look pixel art** : palette de 12 rampes × 4 teintes (`palette.ts`, contrat d'indices avec les shaders), éclairage quantifié en 4 niveaux avec tramage Bayer 4×4, animations cadencées à `ANIM_FPS`.

Les shaders sont des fichiers `.glsl` importés en texte (`?raw`). Le renderer préfixe `#version 300 es` et, pour les fragment shaders, `common.glsl`.

## Écarts assumés et dette connue

- La simulation tourne sur le CPU. À 128×128, un pas coûte quelques millisecondes. Au-delà de 256×256, il faudra la passer dans un Web Worker, puis éventuellement porter diffusion et croissance en shaders ping-pong.
- `World.heightAt` (CPU) et `hBil` (GPU) doivent rester cohérents ; le second lit une altitude quantifiée sur 8 bits.
- Les ressources WebGL ne sont pas restaurées après une perte de contexte (`webglcontextlost`).
- Aucune sauvegarde pour l'instant (voir la feuille de route).
