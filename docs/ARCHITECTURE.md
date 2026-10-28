# Architecture

## Principes

1. **La simulation est pure.** `src/sim` ne connaît ni le DOM ni WebGL. Elle se teste dans Node, pourra passer dans un Web Worker, et son état est sérialisable tel quel (tableaux typés).
2. **Déterminisme.** Tous les tirages passent par `Rng` (mulberry32) initialisé par la graine du monde ; les variations visuelles par cellule utilisent `hash2`, stable. Une même graine redonne le même monde, ce que vérifient les tests.
3. **Données en structure de tableaux.** `World` stocke chaque grandeur dans un `Float32Array` ou `Uint8Array` de n×n cellules. Boucles serrées sans allocation, transfert direct vers des textures GPU.
4. **Le rendu consomme, il ne décide pas.** La simulation lève des drapeaux (`Simulation.dirty`) ; `Renderer.sync` envoie au GPU uniquement ce qui a changé.
5. **Aucune dépendance d'exécution.** TypeScript compilé par Vite, WebGL2 natif. Les dépendances npm sont toutes des outils de développement.

## Flux d'une image

```
Input ──► Hud.state (outil, pinceau, calque, vitesse)
  │
  ▼
main.ts : boucle requestAnimationFrame
  ├─ IsoCamera.update        matrices, accrochage aux pixels
  ├─ raycastTerrain           pointeur → point du relief
  ├─ applyTool                modifie World, lève les drapeaux, nourrit StrokeHistory
  ├─ Simulation.tick × k      pas fixe à SIM_HZ × vitesse, découplé du rendu
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
- accumulation : chaque cellule transmet sa surface drainée (pondérée par le sol, le couvert et l'humidité) à sa voisine aval une fois qu'elle a reçu celle de toutes ses donneuses. Cet ordre topologique (file, en O(n)) remplace un tri par altitude ;
- l'intensité de cours d'eau est un `smoothstep` de cette accumulation. Elle sature l'humidité des berges et dépose des alluvions.

Les paramètres sont regroupés en tête de module (`HYDRO`, `ECO`, `RAIN`, `PEOPLE`) et par sol dans `SOILS`.

## Outils et historique (`src/tools`)

`applyTool` applique un coup de pinceau pendant `dt` secondes. `StrokeHistory` rend les gestes réversibles : au début d'un geste, il retient l'outil ; chaque cellule que l'outil touche pour la première fois est photographiée avant modification, sur les seules grandeurs que l'outil change (relief, sol, fertilité ou arbres). À la fin du geste, il relève les nouvelles valeurs de ces cellules. Annuler ou rétablir ne réécrit que ces cellules, la simulation continue ailleurs ; un arbre ne réapparaît pas sur une cellule labourée ou bâtie entre-temps. Pluie et Peupler n'agissent pas sur la grille et ne s'annulent pas. La pile est bornée (`HISTORY_DEPTH`) et vidée à chaque nouveau monde.

La graine du monde vit dans le fragment d'URL (`#seed=…`, `core/seed.ts`) : le déterminisme de la simulation suffit à redonner la même île à partir d'un lien.

## Sauvegardes

`Simulation.save` copie tout l'état hors genèse : les calques de `World` (`WORLD_LAYERS`), le niveau de la mer, les compteurs, l'état des générateurs aléatoires (`Rng.save`), les nuages, les villages et leurs habitants (chaque habitant désigne son village par son rang). `Simulation.load` le reprend : la suite de la simulation est alors identique au pas près, ce que vérifie un test d'aller-retour.

Le format (`sim/save.ts`) tient en un fichier compressé en gzip (`CompressionStream`, sans dépendance) : l'en-tête « DMRG » et sa version, un JSON pour les objets, puis les calques bruts alignés sur 4 octets. À 256×256, une partie pèse environ 750 Ko. Un fichier étranger, tronqué ou d'une autre version lève une `SaveError`, et un chargement raté rétablit le monde courant.

Côté navigateur (`ui/storage.ts`, `ui/saves.ts`), IndexedDB garde deux emplacements :

- `auto` : écrit chaque minute et quand l'onglet passe en arrière-plan ; au démarrage, la partie reprend, sauf si l'URL désigne une autre graine (lien partagé) ;
- `quick` : écrit par Ctrl+S ou « Sauvegarder », relu par « Charger ».

« Exporter » et « Importer » passent par un fichier `.demiurge`. Les opérations sont faites l'une après l'autre.

## Rendu (`src/render`)

**Caméra** : orthographique, élévation 30° (losanges 2:1), rotation par quarts de tour animée, zoom par paliers en pixels par unité. La cible est accrochée à la grille des pixels basse résolution, ce qui supprime le grouillement en déplacement.

**Passe monde** dans un framebuffer basse résolution (couleur RGBA8 + profondeur 24 bits) :

| Mode `world.frag` | Géométrie            | Rôle                                                                 |
| ----------------- | -------------------- | -------------------------------------------------------------------- |
| 0                 | maillage n×n         | relief : sols, herbe, neige, falaises, cours d'eau, pinceau, calques |
| 1                 | tranches des 4 bords | strates du diorama                                                   |
| 2                 | plan d'eau           | profondeur, reflets, écume                                           |
| 3                 | tranches d'eau       | mer vue de côté                                                      |

Les arbres sont des maillages low-poly dessinés en instanciation ; le vent est appliqué dans le vertex shader. Chaque espèce (feuillu, conifère, buisson) a `TREE_VARIANTS` silhouettes générées au démarrage par un générateur paramétré (`meshes.ts` : nombre et place des masses de feuillage, étages de cônes, hauteur du tronc) à partir d'une graine fixe. Une case choisit sa variante par hachage de sa position : la simulation ne connaît que l'espèce. Toutes les variantes partagent un seul tampon d'instances, trié par variante (tri par comptage) et envoyé en une fois ; chaque appel de dessin décale les attributs d'instance dans ce tampon, faute de « base instance » en WebGL2. Le vertex shader ajoute un étirement vertical, compensé en largeur, dérivé de la graine de l'instance (`u_stretch`, réservé aux arbres). Des tests bornent chaque silhouette : emprise dans la case, posée au sol, budget de sommets. Le même programme dessine les accessoires : habitants (mains vides, chargés de bois ou de grain, positions interpolées entre deux pas de simulation et agrandis aux faibles zooms), maisons, nuages (transparence tramée) et gouttes de pluie (calculées sans état à partir du temps). Les maisons achevées ont une cheminée d'où s'échappe, tant que le village a du bois, une fumée sans état : des bouffées qui montent, grossissent, dérivent avec le vent et se dissipent (trame de plus en plus clairsemée selon leur âge). Nuages, fumée et gouttes n'écrivent pas la profondeur, pour ne pas tracer de contours.

**Bulles d'activité** : `activityOf` (simulation) dit ce que fait chaque habitant (abattage, terrassement, labour, semis, récolte, chantier, bois ou grain rapporté, faim). Un programme dédié (`bubble.vert` / `bubble.frag`) dessine au-dessus de sa tête une bulle de 12×14 pixels basse résolution, à taille fixe quel que soit le zoom et accrochée à la grille des pixels, lue dans un atlas généré au démarrage (`icons.ts`). Les bulles sont dessinées sans test de profondeur et n'apparaissent qu'à partir de 4 pixels par unité ; elles font un petit saut quand l'activité change.

Deux textures n×n portent l'état par cellule :

| Texture    | R        | G           | B                | A        |
| ---------- | -------- | ----------- | ---------------- | -------- |
| `stateTex` | sol      | fertilité   | herbe            | altitude |
| `hydroTex` | humidité | cours d'eau | direction D8 + 1 | champ    |

Le canal champ vaut 0 hors champ, 1 pour une terre labourée, puis croît avec les céréales jusqu'à 255 (mûres). `world.frag` y dessine la terre retournée en sillons et une bordure d'herbe sèche le long des côtés qui ne touchent pas un autre champ. De près (au moins 2,5 pixels par unité), le renderer plante sur les billons 3 rangées de 3 touffes de céréales instanciées (`buildCropMeshes`) : vertes, jaunissantes puis dorées avec épis, grandissant avec la récolte et ondulant sous une vague de vent qui traverse le champ (`u_wave`). De loin, une touffe ferait moins d'un pixel : le sol colore lui-même les rangées.

**Passe finale** : agrandissement au plus proche voisin, contour sombre là où la profondeur saute, ciel en dégradé tramé.

**Look pixel art** : palette de 12 rampes × 4 teintes (`palette.ts`, contrat d'indices avec les shaders), éclairage quantifié en 4 niveaux avec tramage Bayer 4×4, animations cadencées à `ANIM_FPS`.

Les shaders sont des fichiers `.glsl` importés en texte (`?raw`). Le renderer préfixe `#version 300 es` et, pour les fragment shaders, `common.glsl`.

## Écarts assumés et dette connue

- La simulation tourne sur le CPU. À 256×256, un pas coûte environ 5 ms et le réseau d'écoulement autant ; la préhistoire (480 pas) est étalée sur plusieurs images (`Simulation.advanceGenesis`, 12 ms par image) pour que le monde se forme sous les yeux sans bloquer la page. Au-delà, il faudra passer la simulation dans un Web Worker, puis éventuellement porter diffusion et croissance en shaders ping-pong.
- `World.heightAt` (CPU) et `hBil` (GPU) doivent rester cohérents ; le second lit une altitude quantifiée sur 8 bits.
- Les ressources WebGL ne sont pas restaurées après une perte de contexte (`webglcontextlost`).
- Les sauvegardes dépendent de la taille de la grille : une partie n'est rechargée que dans une grille de même côté.
