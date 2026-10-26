import { describe, expect, it } from 'vitest';
import { Activity, activityOf, Carry, People, PEOPLE, Task } from '../src/sim/people';
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
    const sim = new Simulation(1789);
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
});
