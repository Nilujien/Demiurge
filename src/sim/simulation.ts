import { PREHISTORY_TICKS, TICKS_PER_YEAR } from '../config';
import { Rng } from '../core/rng';
import { Ecology } from './ecology';
import { generateTerrain, pioneerCells } from './generate';
import { Hydrology } from './hydrology';
import { People } from './people';
import { Weather } from './weather';
import { World } from './world';

/** Villages fondés à la génération d'un monde : un pour tant de cellules (au moins 2), et habitants de chacun. */
const CELLS_PER_INITIAL_TRIBE = 16384;
const INITIAL_VILLAGERS = 5;
/** La préhistoire recalcule le réseau d'écoulement tous les tant de pas. */
const PREHISTORY_FLOW_EVERY = 40;

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
  population: number;
  fields: number;
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
  /** Pas de préhistoire restant à simuler avant que le monde soit prêt (voir `advanceGenesis`). */
  genesisLeft = 0;
  private genesisDone = 0;

  private rng: Rng;
  private hydrology: Hydrology;
  private ecology: Ecology;
  readonly weather: Weather;
  readonly people: People;

  /** `deferGenesis` : la préhistoire n'est pas simulée ici mais par appels à `advanceGenesis`. */
  constructor(seed: number, size?: number, deferGenesis = false) {
    this.world = new World(size);
    this.rng = new Rng(seed);
    this.hydrology = new Hydrology(this.world);
    this.ecology = new Ecology(this.world, this.rng);
    this.weather = new Weather(this.world);
    this.people = new People(this.world, seed);
    if (deferGenesis) this.beginGenesis(seed);
    else this.generate(seed);
  }

  get years(): number {
    return Math.floor(this.ticks / TICKS_PER_YEAR);
  }

  /** Génère un monde complet d'un coup : relief, puis préhistoire, puis premiers villages. */
  generate(seed: number, prehistory = PREHISTORY_TICKS): void {
    this.beginGenesis(seed, prehistory);
    this.advanceGenesis(Infinity);
  }

  /** Relief et arbres pionniers ; la préhistoire reste à simuler par `advanceGenesis`. */
  beginGenesis(seed: number, prehistory = PREHISTORY_TICKS): void {
    this.rng = new Rng(seed);
    this.ecology = new Ecology(this.world, this.rng);
    this.weather.reset();
    this.people.reset(seed);
    generateTerrain(this.world, seed);
    for (const i of pioneerCells(this.world, seed)) {
      const x = i % this.world.n;
      const z = Math.floor(i / this.world.n);
      if (this.world.orthogonalFree(x, z)) this.ecology.plant(i, 0.6);
    }
    this.hydrology.computeFlow();
    this.ticks = 0;
    this.genesisLeft = prehistory;
    this.genesisDone = 0;
    this.flowDirty = false;
    this.markAll();
    if (prehistory === 0) this.finishGenesis();
  }

  get inGenesis(): boolean {
    return this.genesisLeft > 0;
  }

  /** Avancement de la préhistoire [0, 1]. */
  get genesisProgress(): number {
    const total = this.genesisDone + this.genesisLeft;
    return total ? this.genesisDone / total : 1;
  }

  /**
   * Simule la préhistoire pendant au plus `budgetMs` millisecondes ; retourne true quand le monde est prêt.
   * Le découpage n'influe pas sur le résultat : seul le nombre de pas compte.
   */
  advanceGenesis(budgetMs: number): boolean {
    if (!this.inGenesis) return true;
    const start = performance.now();
    while (this.genesisLeft > 0) {
      this.tick();
      if (this.genesisDone % PREHISTORY_FLOW_EVERY === 0) this.hydrology.computeFlow();
      this.genesisDone++;
      this.genesisLeft--;
      if (performance.now() - start >= budgetMs) break;
    }
    if (this.genesisLeft > 0) return false;
    this.finishGenesis();
    return true;
  }

  private finishGenesis(): void {
    this.hydrology.computeFlow();
    // Les premiers villages s'installent sur une île déjà couverte de végétation.
    const tribes = Math.max(2, Math.round(this.world.cells / CELLS_PER_INITIAL_TRIBE));
    this.people.foundInitial(tribes, INITIAL_VILLAGERS);
    this.ticks = 0;
    this.flowDirty = false;
    this.markAll();
  }

  tick(): void {
    this.ecology.diffuseFertility();
    this.weather.step();
    this.hydrology.step();
    this.ecology.stepVegetation();
    this.people.step();
    if (this.people.heightsChanged) {
      this.people.heightsChanged = false;
      this.dirty.heights = true;
      this.flowDirty = true;
    }
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

  /** Le démiurge verse de l'eau : elle forme un nuage qui tombe en pluie au fil des pas suivants. */
  rain(x: number, z: number, radius: number, dt: number): void {
    this.weather.addRain(x, z, radius, dt);
  }

  /** Fait apparaître un habitant en (x, z) ; retourne false si le lieu est inhabitable. */
  settle(x: number, z: number): boolean {
    return this.people.settle(x, z) !== null;
  }

  stats(): WorldStats {
    const { cells, height, grass, tree, field, seaLevel } = this.world;
    let trees = 0;
    let fields = 0;
    let land = 0;
    let covered = 0;
    for (let i = 0; i < cells; i++) {
      if (tree[i] > 0.3) trees++;
      if (field[i]) fields++;
      if (height[i] > seaLevel) {
        land++;
        if (grass[i] > 0.5 || tree[i] > 0.3) covered++;
      }
    }
    return { trees, population: this.people.population, fields, cover: land ? covered / land : 0 };
  }

  private markAll(): void {
    this.dirty.heights = true;
    this.dirty.state = true;
    this.dirty.trees = true;
  }
}
