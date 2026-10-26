import { TICKS_PER_YEAR } from '../config';
import { Rng } from '../core/rng';
import { Soil } from './soils';
import type { World } from './world';

export const PEOPLE = {
  /** Déplacement par pas (cellules) sur terrain plat. */
  speed: 0.22,
  /** Pas de travail pour abattre un arbre, labourer, semer, récolter. */
  chopTicks: 10,
  tillTicks: 6,
  sowTicks: 3,
  harvestTicks: 5,
  /** Terrassement : correction d'altitude par pas et tolérance d'un terrain jugé plat. */
  flattenStep: 0.12,
  flatTolerance: 0.25,
  /** Dénivelé au-delà duquel une parcelle n'est pas mise en culture. */
  maxFieldRelief: 1.6,
  maxFieldAltitude: 9,
  /** Rayon de travail autour du village. */
  fieldRadius: 9,
  chopRadius: 16,
  woodPerTree: 3,
  grainPerHarvest: 3,
  /** Consommation annuelle par habitant. */
  grainPerYear: 0.1,
  woodPerYear: 0.05,
  houseWood: 6,
  houseCapacity: 4,
  campCapacity: 3,
  /** Progression d'un chantier par pas de travail. */
  buildRate: 0.05,
  fieldsPerVillager: 2.5,
  birthChance: 0.35,
  starveChance: 0.3,
  lifespanMin: 45,
  lifespanMax: 80,
  /** Pas accordés pour atteindre une cible avant d'y renoncer. */
  patience: 260,
  maxVillagers: 320,
  maxTribes: 12,
  /** Distance en deçà de laquelle un nouvel habitant rejoint un village existant. */
  joinRadius: 24,
  /** Essaimage : un village prospère envoie quelques habitants fonder un hameau plus loin. */
  emigrationPopulation: 12,
  emigrationGrain: 30,
  emigrationChance: 0.08,
  emigrants: 3,
  emigrationMin: 18,
  emigrationMax: 40,
} as const;

export const Task = {
  Idle: 0,
  Wander: 1,
  Chop: 2,
  Prepare: 3,
  Sow: 4,
  Harvest: 5,
  Build: 6,
  Return: 7,
} as const;
export type TaskId = (typeof Task)[keyof typeof Task];

export const Carry = { None: 0, Wood: 1, Grain: 2 } as const;
export type CarryId = (typeof Carry)[keyof typeof Carry];

export interface Villager {
  readonly id: number;
  tribe: Tribe;
  x: number;
  z: number;
  /** Position au pas précédent : le rendu interpole entre les deux. */
  px: number;
  pz: number;
  /** Direction de marche (radians, autour de l'axe vertical). */
  heading: number;
  task: TaskId;
  /** Cellule visée, -1 si aucune. */
  target: number;
  /** Pas de travail restants une fois sur place. */
  work: number;
  /** Arrivé à la cible : en train de travailler. */
  working: boolean;
  patience: number;
  carry: CarryId;
  load: number;
  age: number;
  lifespan: number;
  hunger: number;
}

export interface House {
  readonly cell: number;
  /** Altitude du terre-plein. */
  readonly level: number;
  progress: number;
}

export interface Tribe {
  readonly id: number;
  /** Cellule du foyer, où l'on rapporte bois et grain. */
  readonly home: number;
  wood: number;
  grain: number;
  readonly houses: House[];
  readonly fields: number[];
  population: number;
}

/**
 * Populations : des villages dont les habitants parcourent l'île, abattent des arbres pour le bois,
 * aplanissent et labourent des parcelles, sèment et récoltent des céréales, bâtissent des maisons.
 */
export class People {
  readonly villagers: Villager[] = [];
  readonly tribes: Tribe[] = [];
  /** Le relief a été terrassé depuis la dernière lecture. */
  heightsChanged = false;

  private rng: Rng;
  private nextId = 1;
  private ticks = 0;
  /** Cellules déjà visées par un habitant : deux habitants ne travaillent pas la même. */
  private readonly reserved: Uint8Array;

  constructor(
    private readonly world: World,
    seed: number,
  ) {
    this.rng = new Rng(seed ^ 0x5eed1e);
    this.reserved = new Uint8Array(world.cells);
  }

  reset(seed: number): void {
    this.villagers.length = 0;
    this.tribes.length = 0;
    this.reserved.fill(0);
    this.rng = new Rng(seed ^ 0x5eed1e);
    this.ticks = 0;
  }

  get population(): number {
    return this.villagers.length;
  }

  /** Fonde des villages sur les meilleurs sites de l'île : terres basses, plates, fertiles et humides. */
  foundInitial(count: number, villagersEach: number): void {
    const w = this.world;
    const { n } = w;
    const sites: number[] = [];
    for (let attempt = 0; attempt < count; attempt++) {
      let best = -1;
      let bestScore = 0;
      for (let k = 0; k < 400; k++) {
        const x = 4 + Math.floor(this.rng.next() * (n - 8));
        const z = 4 + Math.floor(this.rng.next() * (n - 8));
        const i = z * n + x;
        if (!this.habitable(i)) continue;
        if (sites.some((s) => Math.hypot((s % n) - x, Math.floor(s / n) - z) < 30)) continue;
        const score =
          w.fertility[i] + w.moisture[i] - w.orthogonalRelief(x, z) - Math.max(0, w.height[i] - 5) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) break;
      sites.push(best);
      const tribe = this.found(best);
      for (let v = 0; v < villagersEach; v++) this.spawn(tribe, true);
    }
  }

  /** Un habitant apparaît en (x, z) : il rejoint le village le plus proche ou en fonde un. */
  settle(x: number, z: number): Villager | null {
    const w = this.world;
    const cx = Math.round(x);
    const cz = Math.round(z);
    if (!w.inside(cx, cz)) return null;
    const i = w.index(cx, cz);
    if (!this.habitable(i) || this.villagers.length >= PEOPLE.maxVillagers) return null;
    let tribe: Tribe | null = null;
    let best: number = PEOPLE.joinRadius;
    for (const t of this.tribes) {
      const d = Math.hypot((t.home % w.n) - x, Math.floor(t.home / w.n) - z);
      if (d < best) {
        best = d;
        tribe = t;
      }
    }
    if (!tribe) {
      if (this.tribes.length >= PEOPLE.maxTribes) return null;
      tribe = this.found(i);
    }
    const v = this.spawn(tribe, true);
    v.x = v.px = x;
    v.z = v.pz = z;
    return v;
  }

  step(): void {
    this.ticks++;
    const yearEnd = this.ticks % TICKS_PER_YEAR === 0;
    const w = this.world;

    for (let k = this.villagers.length - 1; k >= 0; k--) {
      const v = this.villagers[k];
      v.px = v.x;
      v.pz = v.z;
      v.age++;
      if (v.age > v.lifespan || w.heightAt(v.x, v.z) < w.seaLevel) {
        this.remove(k);
        continue;
      }
      if (v.task === Task.Idle) this.choose(v);
      this.act(v);
    }

    for (let t = this.tribes.length - 1; t >= 0; t--) {
      const tribe = this.tribes[t];
      this.checkHouses(tribe);
      if (yearEnd) this.yearly(tribe);
      if (tribe.population === 0) this.abandon(t);
    }
  }

  /** Nombre d'habitants que les maisons achevées peuvent loger. */
  capacity(tribe: Tribe): number {
    let built = 0;
    for (const h of tribe.houses) if (h.progress >= 1) built++;
    return PEOPLE.campCapacity + PEOPLE.houseCapacity * built;
  }

  // ---- Cycle de vie -------------------------------------------------------

  private found(home: number): Tribe {
    const tribe: Tribe = {
      id: this.nextId++,
      home,
      wood: 4,
      grain: 15,
      houses: [],
      fields: [],
      population: 0,
    };
    this.tribes.push(tribe);
    return tribe;
  }

  private spawn(tribe: Tribe, adult: boolean): Villager {
    const n = this.world.n;
    const span = PEOPLE.lifespanMin + this.rng.next() * (PEOPLE.lifespanMax - PEOPLE.lifespanMin);
    const x = (tribe.home % n) + (this.rng.next() - 0.5) * 1.5;
    const z = Math.floor(tribe.home / n) + (this.rng.next() - 0.5) * 1.5;
    const v: Villager = {
      id: this.nextId++,
      tribe,
      x,
      z,
      px: x,
      pz: z,
      heading: this.rng.next() * Math.PI * 2,
      task: Task.Idle,
      target: -1,
      work: 0,
      working: false,
      patience: 0,
      carry: Carry.None,
      load: 0,
      age: adult ? Math.floor((14 + this.rng.next() * 20) * TICKS_PER_YEAR) : 0,
      lifespan: Math.floor(span * TICKS_PER_YEAR),
      hunger: 0,
    };
    tribe.population++;
    this.villagers.push(v);
    return v;
  }

  private remove(k: number): void {
    const v = this.villagers[k];
    this.release(v);
    v.tribe.population--;
    this.villagers.splice(k, 1);
  }

  private yearly(tribe: Tribe): void {
    const need = tribe.population * PEOPLE.grainPerYear;
    const fed = tribe.grain >= need;
    tribe.grain = Math.max(0, tribe.grain - need);
    tribe.wood = Math.max(0, tribe.wood - tribe.population * PEOPLE.woodPerYear);
    for (let k = this.villagers.length - 1; k >= 0; k--) {
      const v = this.villagers[k];
      if (v.tribe !== tribe) continue;
      v.hunger = fed ? 0 : v.hunger + 1;
      if (v.hunger >= 3 && this.rng.next() < PEOPLE.starveChance) this.remove(k);
    }
    const cap = this.capacity(tribe);
    if (
      tribe.population > 0 &&
      tribe.population < cap &&
      tribe.grain >= 3 + tribe.population * 0.4 &&
      this.villagers.length < PEOPLE.maxVillagers &&
      this.rng.next() < PEOPLE.birthChance
    ) {
      tribe.grain -= 2;
      this.spawn(tribe, false);
    }
    const building = tribe.houses.some((h) => h.progress < 1);
    if (!building && tribe.population >= cap - 1 && tribe.wood >= PEOPLE.houseWood) this.planHouse(tribe);
    if (
      tribe.population >= PEOPLE.emigrationPopulation &&
      tribe.grain >= PEOPLE.emigrationGrain &&
      this.tribes.length < PEOPLE.maxTribes &&
      this.rng.next() < PEOPLE.emigrationChance
    ) {
      this.emigrate(tribe);
    }
  }

  /** Quelques habitants partent avec des vivres fonder un hameau sur un site libre, à distance. */
  private emigrate(from: Tribe): void {
    const w = this.world;
    const n = w.n;
    const hx = from.home % n;
    const hz = Math.floor(from.home / n);
    let best = -1;
    let bestScore = 0;
    for (let k = 0; k < 60; k++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = PEOPLE.emigrationMin + this.rng.next() * (PEOPLE.emigrationMax - PEOPLE.emigrationMin);
      const x = Math.round(hx + Math.cos(a) * r);
      const z = Math.round(hz + Math.sin(a) * r);
      if (x < 4 || z < 4 || x > n - 5 || z > n - 5) continue;
      const i = z * n + x;
      if (!this.habitable(i) || w.field[i] || w.building[i]) continue;
      const near = this.tribes.some(
        (t) => Math.hypot((t.home % n) - x, Math.floor(t.home / n) - z) < PEOPLE.emigrationMin,
      );
      if (near) continue;
      const score = 0.1 + w.fertility[i] + w.moisture[i] - w.orthogonalRelief(x, z);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return;
    const colony = this.found(best);
    colony.grain = 10;
    colony.wood = 3;
    from.grain -= 10;
    from.wood = Math.max(0, from.wood - 3);
    let moved = 0;
    for (const v of this.villagers) {
      if (moved >= PEOPLE.emigrants) break;
      if (v.tribe !== from || v.carry !== Carry.None) continue;
      this.release(v);
      v.tribe = colony;
      from.population--;
      colony.population++;
      moved++;
      // En route vers le nouveau foyer.
      this.assign(v, Task.Wander, best, 2);
    }
  }

  /** Un village vidé de ses habitants disparaît : ses maisons tombent, ses champs retournent à l'herbe. */
  private abandon(t: number): void {
    const w = this.world;
    const tribe = this.tribes[t];
    for (const h of tribe.houses) w.building[h.cell] = 0;
    for (const f of tribe.fields) {
      w.field[f] = 0;
      w.crop[f] = 0;
    }
    this.tribes.splice(t, 1);
  }

  /** Les maisons et les champs noyés ou retirés par le démiurge sont oubliés. */
  private checkHouses(tribe: Tribe): void {
    const w = this.world;
    for (let k = tribe.houses.length - 1; k >= 0; k--) {
      const h = tribe.houses[k];
      if (w.height[h.cell] < w.seaLevel) {
        w.building[h.cell] = 0;
        tribe.houses.splice(k, 1);
      }
    }
    for (let k = tribe.fields.length - 1; k >= 0; k--) {
      if (!w.field[tribe.fields[k]]) tribe.fields.splice(k, 1);
    }
  }

  private planHouse(tribe: Tribe): void {
    const w = this.world;
    const n = w.n;
    const hx = tribe.home % n;
    const hz = Math.floor(tribe.home / n);
    for (let k = 0; k < 40; k++) {
      const r = 1.5 + this.rng.next() * (2 + tribe.houses.length);
      const a = this.rng.next() * Math.PI * 2;
      const x = Math.round(hx + Math.cos(a) * r);
      const z = Math.round(hz + Math.sin(a) * r);
      if (x < 1 || z < 1 || x > n - 2 || z > n - 2) continue;
      const i = z * n + x;
      if (!this.habitable(i) || w.orthogonalRelief(x, z) > 1.2 || this.reserved[i]) continue;
      if (this.crowded(x, z)) continue;
      w.building[i] = 1;
      w.tree[i] = 0;
      tribe.wood -= PEOPLE.houseWood;
      tribe.houses.push({ cell: i, level: w.height[i], progress: 0 });
      return;
    }
  }

  /** Une maison ou un champ dans le voisinage 3×3 : la place est prise. */
  private crowded(x: number, z: number): boolean {
    const w = this.world;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!w.inside(x + dx, z + dz)) continue;
        const j = w.index(x + dx, z + dz);
        if (w.building[j] || w.field[j]) return true;
      }
    }
    return false;
  }

  private habitable(i: number): boolean {
    const w = this.world;
    return (
      w.height[i] > w.seaLevel + 0.3 &&
      w.height[i] < PEOPLE.maxFieldAltitude &&
      w.soil[i] !== Soil.Rock &&
      w.stream[i] < 0.2
    );
  }

  // ---- Décisions ----------------------------------------------------------

  private choose(v: Villager): void {
    const t = v.tribe;
    const w = this.world;
    if (v.carry !== Carry.None) {
      if (w.height[t.home] >= w.seaLevel) return this.assign(v, Task.Return, t.home, 0);
      v.carry = Carry.None; // foyer noyé : la charge est perdue
    }

    const site = t.houses.find((h) => h.progress < 1);
    if (site && this.rng.next() < 0.5) return this.assign(v, Task.Build, site.cell, 0);

    const ripe = this.nearestField(v, (i) => w.crop[i] >= 1);
    if (ripe >= 0) return this.assign(v, Task.Harvest, ripe, PEOPLE.harvestTicks);

    const woodTarget = 2 + t.population * 0.3 + (t.population >= this.capacity(t) - 1 ? PEOPLE.houseWood : 0);
    if (t.wood < woodTarget && this.rng.next() < 0.55) {
      const tree = this.nearestTree(v);
      if (tree >= 0) return this.assign(v, Task.Chop, tree, PEOPLE.chopTicks);
    }

    const fallow = this.nearestField(v, (i) => w.crop[i] === 0);
    if (fallow >= 0) return this.assign(v, Task.Sow, fallow, PEOPLE.sowTicks);

    if (t.fields.length < 2 + t.population * PEOPLE.fieldsPerVillager) {
      const plot = this.findPlot(t);
      if (plot >= 0) return this.assign(v, Task.Prepare, plot, PEOPLE.tillTicks);
    }

    // Rien à faire : flânerie autour du village.
    const n = w.n;
    const a = this.rng.next() * Math.PI * 2;
    const r = 1 + this.rng.next() * 6;
    const x = Math.round((t.home % n) + Math.cos(a) * r);
    const z = Math.round(Math.floor(t.home / n) + Math.sin(a) * r);
    if (w.inside(x, z) && w.height[w.index(x, z)] > w.seaLevel) {
      this.assign(v, Task.Wander, w.index(x, z), 4 + Math.floor(this.rng.next() * 12));
    }
  }

  private assign(v: Villager, task: TaskId, target: number, work: number): void {
    v.task = task;
    v.target = target;
    v.work = work;
    v.working = false;
    v.patience = PEOPLE.patience;
    if (task === Task.Chop || task === Task.Prepare || task === Task.Sow || task === Task.Harvest) {
      this.reserved[target] = 1;
    }
  }

  private release(v: Villager): void {
    if (v.target >= 0 && v.task !== Task.Build && v.task !== Task.Return && v.task !== Task.Wander) {
      this.reserved[v.target] = 0;
    }
    v.task = Task.Idle;
    v.target = -1;
    v.working = false;
  }

  private nearestField(v: Villager, ok: (i: number) => boolean): number {
    const n = this.world.n;
    let best = -1;
    let bestD = Infinity;
    for (const i of v.tribe.fields) {
      if (this.reserved[i] || !ok(i)) continue;
      const d = Math.hypot((i % n) - v.x, Math.floor(i / n) - v.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private nearestTree(v: Villager): number {
    const w = this.world;
    const { n, tree } = w;
    const hx = v.tribe.home % n;
    const hz = Math.floor(v.tribe.home / n);
    const R = PEOPLE.chopRadius;
    let best = -1;
    let bestD = Infinity;
    for (let z = Math.max(0, hz - R); z <= Math.min(n - 1, hz + R); z++) {
      for (let x = Math.max(0, hx - R); x <= Math.min(n - 1, hx + R); x++) {
        const i = z * n + x;
        if (tree[i] < 0.5 || this.reserved[i] || w.height[i] < w.seaLevel) continue;
        if (Math.hypot(x - hx, z - hz) > R) continue;
        const d = Math.hypot(x - v.x, z - v.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** Une parcelle à mettre en culture : de préférence contiguë aux champs existants, peu pentue. */
  private findPlot(t: Tribe): number {
    const w = this.world;
    const n = w.n;
    const hx = t.home % n;
    const hz = Math.floor(t.home / n);
    const R = PEOPLE.fieldRadius + Math.sqrt(t.fields.length);
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < 30; k++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = 2 + Math.sqrt(this.rng.next()) * R;
      const x = Math.round(hx + Math.cos(a) * r);
      const z = Math.round(hz + Math.sin(a) * r);
      if (x < 1 || z < 1 || x > n - 2 || z > n - 2) continue;
      const i = z * n + x;
      if (!this.plotFree(i, x, z)) continue;
      const relief = w.orthogonalRelief(x, z);
      if (relief > PEOPLE.maxFieldRelief) continue;
      let neighbours = 0;
      if (w.field[i - 1]) neighbours++;
      if (w.field[i + 1]) neighbours++;
      if (w.field[i - n]) neighbours++;
      if (w.field[i + n]) neighbours++;
      const score = neighbours * 1.5 - r / R - relief + w.fertility[i] + w.moisture[i] * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** Parcelle cultivable ; `own` : la réservation est celle de l'habitant qui la prépare. */
  private plotFree(i: number, x: number, z: number, own = false): boolean {
    const w = this.world;
    if (!this.habitable(i) || w.field[i] || w.tree[i] > 0 || (this.reserved[i] && !own)) return false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (w.building[w.index(x + dx, z + dz)]) return false;
    }
    return true;
  }

  // ---- Actions ------------------------------------------------------------

  private act(v: Villager): void {
    if (v.task === Task.Idle || v.target < 0) {
      v.task = Task.Idle;
      return;
    }
    const w = this.world;
    const n = w.n;
    const i = v.target;
    const tx = i % n;
    const tz = Math.floor(i / n);

    if (!v.working) {
      const reach = v.task === Task.Chop || v.task === Task.Build ? 0.75 : 0.3;
      const dx = tx - v.x;
      const dz = tz - v.z;
      const d = Math.hypot(dx, dz);
      if (d <= reach) {
        v.working = true;
      } else {
        if (--v.patience <= 0) return this.release(v);
        // Plus lent en montée ; l'eau est infranchissable.
        const h0 = w.heightAt(v.x, v.z);
        const step = Math.min(d, PEOPLE.speed);
        const nx = v.x + (dx / d) * step;
        const nz = v.z + (dz / d) * step;
        const h1 = w.heightAt(nx, nz);
        if (h1 < w.seaLevel + 0.05) return this.release(v);
        const climb = Math.max(0, h1 - h0) / step;
        const k = 1 / (1 + climb * 1.5);
        v.x += (dx / d) * step * k;
        v.z += (dz / d) * step * k;
        v.heading = Math.atan2(dz, dx);
        return;
      }
    }

    switch (v.task) {
      case Task.Wander:
        if (--v.work <= 0) this.release(v);
        break;
      case Task.Chop:
        if (w.tree[i] <= 0) return this.release(v);
        if (--v.work <= 0) {
          v.carry = Carry.Wood;
          v.load = 1 + PEOPLE.woodPerTree * w.tree[i];
          w.tree[i] = 0;
          this.release(v);
        }
        break;
      case Task.Prepare:
        if (!this.plotFree(i, tx, tz, true)) return this.release(v);
        if (this.flatten(i, tx, tz)) {
          if (--v.patience <= 0) this.release(v);
          break;
        }
        if (--v.work <= 0) {
          w.field[i] = 1;
          w.crop[i] = 0;
          w.grass[i] = 0;
          v.tribe.fields.push(i);
          this.reserved[i] = 0;
          this.assign(v, Task.Sow, i, PEOPLE.sowTicks);
          v.working = true;
        }
        break;
      case Task.Sow:
        if (!w.field[i] || w.crop[i] > 0) return this.release(v);
        if (--v.work <= 0) {
          w.crop[i] = 0.02;
          this.release(v);
        }
        break;
      case Task.Harvest:
        if (!w.field[i] || w.crop[i] < 1) return this.release(v);
        if (--v.work <= 0) {
          w.crop[i] = 0;
          v.carry = Carry.Grain;
          v.load = PEOPLE.grainPerHarvest;
          this.release(v);
        }
        break;
      case Task.Build: {
        const house = v.tribe.houses.find((h) => h.cell === i);
        if (!house || house.progress >= 1) return this.release(v);
        this.level(i, tx, tz, house.level, true);
        house.progress = Math.min(1, house.progress + PEOPLE.buildRate);
        if (house.progress >= 1) this.release(v);
        break;
      }
      case Task.Return:
        if (v.carry === Carry.Wood) v.tribe.wood += v.load;
        else if (v.carry === Carry.Grain) v.tribe.grain += v.load;
        v.carry = Carry.None;
        v.load = 0;
        this.release(v);
        break;
    }
  }

  /**
   * Aplanit une parcelle en terrasse : la cellule et ses voisines orthogonales (hors champs et maisons)
   * sont ramenées vers le niveau du champ voisin ou, à défaut, de la cellule. Retourne true tant qu'il reste à faire.
   */
  private flatten(i: number, x: number, z: number): boolean {
    const w = this.world;
    const n = w.n;
    let level = w.height[i];
    for (const j of [i - 1, i + 1, i - n, i + n]) {
      if (w.field[j] && Math.abs(w.height[j] - level) < PEOPLE.maxFieldRelief) {
        level = w.height[j];
        break;
      }
    }
    return this.level(i, x, z, level, false);
  }

  private level(i: number, x: number, z: number, level: number, wide: boolean): boolean {
    const w = this.world;
    const n = w.n;
    let busy = false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!wide && dx !== 0 && dz !== 0) continue;
        if (!w.inside(x + dx, z + dz)) continue;
        const j = i + dz * n + dx;
        if (j !== i && (w.field[j] || w.building[j] || w.height[j] < w.seaLevel)) continue;
        const d = level - w.height[j];
        if (Math.abs(d) <= PEOPLE.flatTolerance * (j === i ? 0.4 : 1)) continue;
        w.height[j] += Math.max(-PEOPLE.flattenStep, Math.min(PEOPLE.flattenStep, d));
        busy = true;
      }
    }
    if (busy) this.heightsChanged = true;
    return busy;
  }
}
