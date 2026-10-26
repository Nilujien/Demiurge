/** Paramètres globaux du monde et du moteur. Unité spatiale : 1 = une cellule de la grille. */

/** Côté de la grille de simulation (cellules). */
export const GRID = 256;

/** Altitude minimale et maximale encodables (unités monde). */
export const H_MIN = -10;
export const H_MAX = 24;

/** Altitude du socle du diorama (bas des tranches). */
export const BASE = -10;

/** Altitude à partir de laquelle la neige s'installe. */
export const SNOW_LINE = 14.5;

/** Fréquence de la simulation (pas par seconde) et nombre de pas par « année » affichée. */
export const SIM_HZ = 8;
export const TICKS_PER_YEAR = 8;

/** Cadence des animations pixel art (images par seconde), indépendante du rendu. */
export const ANIM_FPS = 6;

/** Nombre de pas de « préhistoire » simulés à la génération d'un monde. */
export const PREHISTORY_TICKS = 480;
