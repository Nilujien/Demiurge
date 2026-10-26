import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';

describe('Simulation', () => {
  it('est entièrement déterministe pour une graine donnée', () => {
    const a = new Simulation(99, 48);
    const b = new Simulation(99, 48);
    for (let t = 0; t < 40; t++) {
      a.tick();
      b.tick();
    }
    expect(a.world.tree).toEqual(b.world.tree);
    expect(a.world.treeKind).toEqual(b.world.treeKind);
    expect(a.world.moisture).toEqual(b.world.moisture);
    expect(a.people.villagers.map((v) => [v.x, v.z])).toEqual(b.people.villagers.map((v) => [v.x, v.z]));
  });

  it('les villages cultivent des champs au fil des années', () => {
    const sim = new Simulation(1789);
    for (let t = 0; t < 400; t++) sim.tick();
    const s = sim.stats();
    expect(s.population).toBeGreaterThan(0);
    expect(s.fields).toBeGreaterThan(0);
  });

  it('produit des forêts et des cours d’eau pendant la préhistoire', () => {
    const sim = new Simulation(1789);
    const s = sim.stats();
    expect(s.trees).toBeGreaterThan(100);
    expect(s.cover).toBeGreaterThan(0.1);
    expect(sim.world.stream.some((v) => v > 0)).toBe(true);
  });

  it('donne le même monde, que la genèse soit faite d’un coup ou par tranches', () => {
    const whole = new Simulation(7, 48);
    const chunked = new Simulation(7, 48, true);
    expect(chunked.inGenesis).toBe(true);
    let slices = 0;
    while (!chunked.advanceGenesis(0)) slices++;
    expect(slices).toBeGreaterThan(10);
    expect(chunked.genesisProgress).toBe(1);
    expect(chunked.world.tree).toEqual(whole.world.tree);
    expect(chunked.world.height).toEqual(whole.world.height);
    expect(chunked.people.population).toBe(whole.people.population);
  });

  it('remet les compteurs à zéro et signale tout comme modifié après génération', () => {
    const sim = new Simulation(3, 32);
    sim.tick();
    sim.dirty.heights = false;
    sim.generate(4, 10);
    expect(sim.ticks).toBe(0);
    expect(sim.dirty.heights).toBe(true);
  });
});
