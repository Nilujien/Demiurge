import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Soil } from '../src/sim/soils';
import { applyTool, type Stroke } from '../src/tools/tools';

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  x: 16,
  z: 16,
  radius: 3,
  dt: 0.1,
  soil: Soil.Clay,
  flattenTo: 0,
  random: () => 0,
  ...over,
});

describe('applyTool', () => {
  it('élève le relief dans le rayon du pinceau seulement', () => {
    const sim = new Simulation(1, 32);
    const w = sim.world;
    const before = w.height.slice();
    sim.dirty.heights = false;
    applyTool(sim, 'raise', stroke());
    expect(w.height[w.index(16, 16)]).toBeGreaterThan(before[w.index(16, 16)]);
    expect(w.height[w.index(16, 22)]).toBe(before[w.index(16, 22)]);
    expect(sim.dirty.heights).toBe(true);
    expect(sim.flowDirty).toBe(true);
  });

  it('peint le sol choisi au centre du pinceau', () => {
    const sim = new Simulation(1, 32);
    applyTool(sim, 'soil', stroke());
    expect(sim.world.soil[sim.world.index(16, 16)]).toBe(Soil.Clay);
  });

  it('abat les arbres', () => {
    const sim = new Simulation(1, 32);
    const i = sim.world.index(16, 16);
    sim.world.tree[i] = 1;
    applyTool(sim, 'cut', stroke());
    expect(sim.world.tree[i]).toBe(0);
  });

  it('aplanit vers l’altitude visée', () => {
    const sim = new Simulation(1, 32);
    const i = sim.world.index(16, 16);
    sim.world.height[i] = 10;
    for (let k = 0; k < 30; k++) applyTool(sim, 'flatten', stroke({ flattenTo: 2 }));
    expect(sim.world.height[i]).toBeCloseTo(2, 1);
  });
});
