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
  });

  it('produit des forêts et des cours d’eau pendant la préhistoire', () => {
    const sim = new Simulation(1789);
    const s = sim.stats();
    expect(s.trees).toBeGreaterThan(100);
    expect(s.cover).toBeGreaterThan(0.1);
    expect(sim.world.stream.some((v) => v > 0)).toBe(true);
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
