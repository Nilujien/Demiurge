import { PREHISTORY_TICKS, TICKS_PER_YEAR } from '../config';
import { Rng } from '../core/rng';
import { Ecology } from './ecology';
import { generateTerrain, pioneerCells } from './generate';
import { Hydrology } from './hydrology';
import { World } from './world';

/** Ce qui a changé depuis le dernier rendu ; le moteur de rendu remet les drapeaux à false. */
export interface Dirty {
  /** Relief ou niveau de la mer : maillages à reconstruire. */
  heights: boolean;
  /** Sols, fertilité, herbe, humidité : textures d'état à renvoyer au GPU. */
  state: boolean;
  /** Arbres : instances à reconstruire. */
  trees: boolean;
}

export interface WorldStats {
  trees: number;
  /** Part des terres émergées couvertes d'herbe dense ou d'arbres [0, 1]. */
  cover: number;
}

/** Orchestration d'un pas de simulation. Aucune dépendance au DOM ni à WebGL. */
export class Simulation {
  readonly world: World;
  readonly dirty: Dirty = { heights: true, state: true, trees: true };
  ticks = 0;
  /** Le réseau d'écoulement doit être recalculé (relief, sols ou couvert modifiés). */
  flowDirty = true;

  private rng: Rng;
  private hydrology: Hydrology;
  private ecology: Ecology;

  constructor(seed: number, size?: number) {
    this.world = new World(size);
    this.rng = new Rng(seed);
    this.hydrology = new Hydrology(this.world);
    this.ecology = new Ecology(this.world, this.rng);
    this.generate(seed);
  }

  get years(): number {
    return Math.floor(this.ticks / TICKS_PER_YEAR);
  }

  generate(seed: number, prehistory = PREHISTORY_TICKS): void {
    this.rng = new Rng(seed);
    this.ecology = new Ecology(this.world, this.rng);
    generateTerrain(this.world, seed);
    for (const i of pioneerCells(this.world, seed)) {
      const x = i % this.world.n;
      const z = Math.floor(i / this.world.n);
      if (this.world.orthogonalFree(x, z)) this.ecology.plant(i, 0.6);
    }
    this.hydrology.computeFlow();
    for (let t = 0; t < prehistory; t++) {
      this.tick();
      if (t % 40 === 0) this.hydrology.computeFlow();
    }
    this.hydrology.computeFlow();
    this.ticks = 0;
    this.flowDirty = false;
    this.markAll();
  }

  tick(): void {
    this.ecology.diffuseFertility();
    this.hydrology.step();
    this.ecology.stepVegetation();
    this.ticks++;
    if (this.ticks % 16 === 0) this.flowDirty = true;
    this.dirty.state = true;
    this.dirty.trees = true;
  }

  /** Recalcule le réseau d'écoulement si nécessaire. Appelé par la boucle, avec limitation de fréquence. */
  updateFlow(): void {
    if (!this.flowDirty) return;
    this.hydrology.computeFlow();
    this.flowDirty = false;
    this.dirty.state = true;
  }

  setSeaLevel(level: number): void {
    this.world.seaLevel = level;
    this.flowDirty = true;
    this.markAll();
  }

  plant(i: number): void {
    this.ecology.plant(i);
  }

  stats(): WorldStats {
    const { cells, height, grass, tree, seaLevel } = this.world;
    let trees = 0;
    let land = 0;
    let covered = 0;
    for (let i = 0; i < cells; i++) {
      if (tree[i] > 0.3) trees++;
      if (height[i] > seaLevel) {
        land++;
        if (grass[i] > 0.5 || tree[i] > 0.3) covered++;
      }
    }
    return { trees, cover: land ? covered / land : 0 };
  }

  private markAll(): void {
    this.dirty.heights = true;
    this.dirty.state = true;
    this.dirty.trees = true;
  }
}
