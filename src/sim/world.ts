import { GRID } from '../config';

/**
 * État du monde : une grille n×n de cellules stockée en tableaux typés (structure de tableaux).
 * Index d'une cellule : z * n + x. Les hauteurs sont portées par les sommets de la grille,
 * donc la cellule (x, z) est centrée sur le point monde (x, z).
 */
export class World {
  readonly n: number;
  readonly cells: number;

  /** Altitude (unités monde). */
  readonly height: Float32Array;
  /** Type de sol, voir `Soil`. */
  readonly soil: Uint8Array;
  /** Fertilité [0, 1]. */
  readonly fertility: Float32Array;
  /** Couvert herbacé [0, 1]. */
  readonly grass: Float32Array;
  /** Croissance de l'arbre [0, 1] ; 0 = pas d'arbre. */
  readonly tree: Float32Array;
  /** Espèce de l'arbre, voir `TreeKind`. */
  readonly treeKind: Uint8Array;
  /** Humidité du sol [0, 1]. */
  readonly moisture: Float32Array;
  /** Direction d'écoulement D8 (0–7), -1 pour une cuvette. */
  readonly flowDir: Int8Array;
  /** Surface drainée amont pondérée. */
  readonly flowAcc: Float32Array;
  /** Intensité de cours d'eau [0, 1] dérivée de flowAcc. */
  readonly stream: Float32Array;

  seaLevel = 0;

  constructor(n = GRID) {
    this.n = n;
    this.cells = n * n;
    this.height = new Float32Array(this.cells);
    this.soil = new Uint8Array(this.cells);
    this.fertility = new Float32Array(this.cells);
    this.grass = new Float32Array(this.cells);
    this.tree = new Float32Array(this.cells);
    this.treeKind = new Uint8Array(this.cells);
    this.moisture = new Float32Array(this.cells);
    this.flowDir = new Int8Array(this.cells);
    this.flowAcc = new Float32Array(this.cells);
    this.stream = new Float32Array(this.cells);
  }

  index(x: number, z: number): number {
    return z * this.n + x;
  }

  inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.n && z < this.n;
  }

  isUnderwater(i: number): boolean {
    return this.height[i] < this.seaLevel;
  }

  /** Altitude interpolée en un point monde ; -Infinity hors de la grille. */
  heightAt(x: number, z: number): number {
    const n = this.n;
    if (x < 0 || z < 0 || x > n - 1 || z > n - 1) return -Infinity;
    const xi = Math.min(Math.floor(x), n - 2);
    const zi = Math.min(Math.floor(z), n - 2);
    const fx = x - xi;
    const fz = z - zi;
    const i = zi * n + xi;
    const h = this.height;
    return (h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fz) + (h[i + n] * (1 - fx) + h[i + n + 1] * fx) * fz;
  }

  /** Aucun arbre sur les 4 voisins orthogonaux : espacement naturel des troncs. */
  orthogonalFree(x: number, z: number): boolean {
    const i = this.index(x, z);
    const t = this.tree;
    const n = this.n;
    return !(
      (x > 0 && t[i - 1] > 0) ||
      (x < n - 1 && t[i + 1] > 0) ||
      (z > 0 && t[i - n] > 0) ||
      (z < n - 1 && t[i + n] > 0)
    );
  }
}
