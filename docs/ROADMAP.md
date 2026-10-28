# Feuille de route

## Fait

- **0.1** : relief procédural, caméra iso pixel art, sculpture, sols, fertilité, forêts émergentes.
- **0.2** : humidité et ruissellement, cours d'eau et mares, outils Arroser et Abattre, calques humidité et fertilité. Migration vers TypeScript + Vite, simulation déterministe et testée.

- **0.3** (en cours) : villages et habitants (abattage, terrassement, labours, céréales, maisons, essaimage) ; outil Peupler ; l'outil Arroser devient Pluie, l'eau du démiurge tombant de nuages qui dérivent. Confort : annuler / rétablir les coups de pinceau, graine du monde dans l'URL et partageable, vitesse ×1 / ×2 / ×4, infobulle des villages. Sauvegarde : reprise automatique de la partie, sauvegarde rapide (Ctrl+S), export et import d'un fichier `.demiurge`.

## Prochaines étapes

1. **Mobile** : profiler sur un téléphone d'entrée de gamme, réglage automatique de la taille de pixel, interface tactile repensée (barre d'outils au pouce).
2. **PWA** : manifeste et service worker pour l'installation et le jeu hors ligne.
3. **Simulation dans un Web Worker** : boucle de jeu fluide quelle que soit la taille de la grille ; transfert des tableaux par `postMessage` avec transfert de propriété.
4. **Écosystème** : saisons, incendies, érosion lente par les cours d'eau, biomes (marais sur argile détrempée, dunes sur sable sec).
5. **Rendu** : perte de contexte WebGL, ombres portées des arbres, cycle jour/nuit sur la palette.
