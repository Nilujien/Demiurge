import { describe, expect, it } from 'vitest';
import { Activity, activityOf, Carry, People, PEOPLE, Task } from '../src/sim/people';
import { Ecology } from '../src/sim/ecology';
import { Rng } from '../src/core/rng';
import { Simulation } from '../src/sim/simulation';
import { Soil } from '../src/sim/soils';
import { World } from '../src/sim/world';

function plain(n = 40): World {
  const w = new World(n);
  w.height.fill(2);
  w.soil.fill(Soil.Humus);
  w.fertility.fill(0.8);
  w.moisture.fill(0.5);
  return w;
}

describe('People', () => {
  it('fonde les villages initiaux sur des terres habitables', () => {
    const sim = new Simulation(1789, 128);
    const { people, world } = sim;
    expect(people.tribes.length).toBeGreaterThan(0);
    expect(people.population).toBeGreaterThan(0);
    for (const t of people.tribes) expect(world.height[t.home]).toBeGreaterThan(world.seaLevel);
  });

  it('abat les arbres proches pour rapporter du bois au village', () => {
    const w = plain();
    const people = new People(w, 1);
    const v = people.settle(20, 20);
    expect(v).not.toBeNull();
    const tribe = v!.tribe;
    tribe.grain = 50;
    tribe.wood = 0;
    const tree = w.index(24, 20);
    w.tree[tree] = 1;
    for (let t = 0; t < 400 && tribe.wood === 0; t++) people.step();
    expect(w.tree[tree]).toBe(0);
    expect(tribe.wood).toBeGreaterThan(0);
  });

  it('aplanit, laboure, sème puis récolte des céréales', () => {
    const w = plain();
    // Pente douce : les parcelles doivent être terrassées avant d'être labourées.
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) w.height[w.index(x, z)] = 2 + x * 0.3;
    const people = new People(w, 2);
    const v = people.settle(20, 20)!;
    const tribe = v.tribe;
    tribe.wood = 50;
    tribe.grain = 50;
    const before = w.height.slice();
    let flattened = false;
    for (let t = 0; t < 300; t++) {
      people.step();
      if (people.heightsChanged) flattened = true;
    }
    expect(flattened).toBe(true);
    expect(w.height).not.toEqual(before);
    expect(tribe.fields.length).toBeGreaterThan(0);
    const f = tribe.fields[0];
    expect(w.field[f]).toBe(1);
    expect(w.grass[f]).toBe(0);
    expect(tribe.fields.some((i) => w.crop[i] > 0)).toBe(true);

    // Céréales mûres : elles sont récoltées et le grain rapporté au village.
    for (const i of tribe.fields) w.crop[i] = 1;
    const grain = tribe.grain;
    for (let t = 0; t < 200 && tribe.grain <= grain; t++) people.step();
    expect(tribe.grain).toBeGreaterThan(grain);
  });

  it('les habitants ne marchent pas dans la mer', () => {
    const w = plain();
    const people = new People(w, 3);
    people.settle(10, 10);
    for (let x = 20; x < w.n; x++) for (let z = 0; z < w.n; z++) w.height[w.index(x, z)] = -3;
    for (let t = 0; t < 300; t++) people.step();
    for (const v of people.villagers) expect(w.heightAt(v.x, v.z)).toBeGreaterThan(w.seaLevel);
  });

  it('un village affamé dépérit et disparaît', () => {
    const w = plain();
    const people = new People(w, 4);
    const tribe = people.settle(20, 20)!.tribe;
    for (let k = 0; k < 4; k++) people.settle(20, 20);
    for (const v of people.villagers) v.lifespan = 1e9;
    for (let t = 0; t < 8 * 60; t++) {
      tribe.grain = 0; // aucune récolte n'arrive jusqu'au grenier
      people.step();
    }
    expect(people.population).toBe(0);
    expect(people.tribes).toHaveLength(0);
  });

  it('ne dépasse jamais la population maximale', () => {
    const w = plain();
    const people = new People(w, 5);
    for (let k = 0; k < PEOPLE.maxVillagers + 20; k++) people.settle(20, 20);
    expect(people.population).toBe(PEOPLE.maxVillagers);
  });

  it("expose l'activité du moment pour les bulles", () => {
    const w = plain();
    const people = new People(w, 6);
    const v = people.settle(20, 20)!;
    v.task = Task.Chop;
    expect(activityOf(v)).toBe(Activity.Chop);
    v.task = Task.Prepare;
    v.working = true;
    v.terracing = true;
    expect(activityOf(v)).toBe(Activity.Terrace);
    v.terracing = false;
    expect(activityOf(v)).toBe(Activity.Till);
    v.task = Task.Return;
    v.carry = Carry.Grain;
    expect(activityOf(v)).toBe(Activity.Grain);
    v.task = Task.Wander;
    expect(activityOf(v)).toBe(Activity.None);
    v.hunger = 1;
    expect(activityOf(v)).toBe(Activity.Hungry);
  });

  it('signale le terrassement pendant la préparation d’une parcelle en pente', () => {
    const w = plain();
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) w.height[w.index(x, z)] = 2 + x * 0.3;
    const people = new People(w, 2);
    people.settle(20, 20)!.tribe.grain = 50;
    const seen = new Set<number>();
    for (let t = 0; t < 300; t++) {
      people.step();
      for (const v of people.villagers) seen.add(activityOf(v));
    }
    expect(seen.has(Activity.Terrace)).toBe(true);
    expect(seen.has(Activity.Sow)).toBe(true);
  });

  it('ressème aussitôt après la moisson, sans trajet supplémentaire', () => {
    const w = plain();
    const people = new People(w, 7);
    const v = people.settle(20, 20)!;
    v.tribe.grain = 50;
    v.tribe.wood = 50;
    const f = w.index(21, 20);
    w.field[f] = 1;
    w.crop[f] = 1;
    v.tribe.fields.push(f);
    // Au moment où le champ est ressemé, le moissonneur porte encore sa récolte : pas d'aller-retour.
    for (let t = 0; t < 60 && !(w.crop[f] > 0 && w.crop[f] < 1); t++) people.step();
    expect(w.crop[f]).toBeCloseTo(0.02);
    expect(v.carry).toBe(Carry.Grain);
  });

  it('cueille quand le grenier est vide', () => {
    const w = plain();
    w.grass.fill(0.9);
    const people = new People(w, 8);
    const tribe = people.settle(20, 20)!.tribe;
    people.settle(20, 20);
    tribe.grain = 0;
    let foraged = false;
    for (let t = 0; t < 200 && !foraged; t++) {
      people.step();
      foraged = people.villagers.some((v) => activityOf(v) === Activity.Forage) || tribe.grain > 0;
    }
    expect(foraged).toBe(true);
  });

  it('un village prospère envoie du grain à un voisin affamé, par voie de terre seulement', () => {
    /** Plus grosse livraison reçue d'un coup par le village pauvre (la cueillette ne rapporte que 1). */
    const run = (water: boolean): number => {
      const w = plain(80);
      w.grass.fill(0.9); // de quoi cueillir en attendant les secours
      if (water) for (let z = 0; z < w.n; z++) for (let x = 20; x < 24; x++) w.height[w.index(x, z)] = -3;
      const people = new People(w, 9);
      const rich = people.settle(10, 40)!.tribe;
      for (let k = 0; k < 3; k++) people.settle(10, 40);
      const poor = people.settle(35, 40)!.tribe;
      for (let k = 0; k < 2; k++) people.settle(35, 40);
      for (const v of people.villagers) v.lifespan = 1e9;
      rich.grain = 500;
      poor.grain = 0;
      let biggest = 0;
      for (let t = 0; t < 8 * 40; t++) {
        const before = poor.grain;
        people.step();
        biggest = Math.max(biggest, poor.grain - before);
      }
      return biggest;
    };
    expect(run(false)).toBeGreaterThanOrEqual(PEOPLE.aidLoad - 1);
    expect(run(true)).toBeLessThan(PEOPLE.aidLoad - 1);
  });

  it('les trajets usent le sol et y tracent des sentiers', () => {
    const w = plain();
    const people = new People(w, 10);
    const v = people.settle(10, 20)!;
    v.tribe.grain = 50;
    v.tribe.wood = 0;
    w.tree[w.index(18, 20)] = 1;
    for (let t = 0; t < 200; t++) people.step();
    expect(w.wear[w.index(14, 20)]).toBeGreaterThan(0);
  });

  it('compte les décès par cause', () => {
    const w = plain();
    const people = new People(w, 11);
    const v = people.settle(20, 20)!;
    v.age = v.lifespan;
    people.step();
    expect(people.deaths.age).toBe(1);
  });
});

describe('Sentiers', () => {
  it("s'effacent et laissent repousser l'herbe quand plus personne n'y passe", () => {
    const w = plain(8);
    w.wear.fill(1);
    const eco = new Ecology(w, new Rng(1));
    for (let t = 0; t < 50; t++) eco.stepVegetation();
    const trodden = w.grass[w.index(4, 4)];
    for (let t = 0; t < 2000; t++) eco.stepVegetation();
    expect(w.wear[w.index(4, 4)]).toBeLessThan(0.05);
    expect(w.grass[w.index(4, 4)]).toBeGreaterThan(trodden);
  });
});
