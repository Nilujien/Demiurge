import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { Ecology } from '../src/sim/ecology';
import { Soil } from '../src/sim/soils';
import { World } from '../src/sim/world';

function flat(soil: number, n = 8): World {
  const w = new World(n);
  w.height.fill(2);
  w.soil.fill(soil);
  w.fertility.fill(1);
  w.moisture.fill(0.6);
  return w;
}

describe('Ecology', () => {
  it('ne fait rien pousser sur la roche et y tue les arbres', () => {
    const w = flat(Soil.Rock);
    w.tree[w.index(3, 3)] = 0.5;
    const eco = new Ecology(w, new Rng(1));
    for (let t = 0; t < 100; t++) eco.stepVegetation();
    expect(Math.max(...w.grass)).toBe(0);
    expect(w.tree[w.index(3, 3)]).toBe(0);
  });

  it("fait pousser l'herbe sur un humus fertile et humide", () => {
    const w = flat(Soil.Humus);
    const eco = new Ecology(w, new Rng(1));
    for (let t = 0; t < 100; t++) eco.stepVegetation();
    expect(w.grass[w.index(4, 4)]).toBeGreaterThan(0.9);
  });

  it("l'herbe ne pousse pas sur un sol sec", () => {
    const w = flat(Soil.Humus);
    w.moisture.fill(0.02);
    const eco = new Ecology(w, new Rng(1));
    for (let t = 0; t < 100; t++) eco.stepVegetation();
    expect(w.grass[w.index(4, 4)]).toBeLessThan(0.01);
  });

  it('noie la végétation sous le niveau de la mer', () => {
    const w = flat(Soil.Humus);
    w.grass.fill(1);
    w.tree[w.index(2, 2)] = 1;
    w.seaLevel = 5;
    new Ecology(w, new Rng(1)).stepVegetation();
    expect(w.tree[w.index(2, 2)]).toBe(0);
    expect(w.grass[w.index(2, 2)]).toBe(0);
  });

  it('fait grandir un arbre planté', () => {
    const w = flat(Soil.Humus);
    const eco = new Ecology(w, new Rng(1));
    const i = w.index(4, 4);
    eco.plant(i);
    const before = w.tree[i];
    for (let t = 0; t < 20; t++) eco.stepVegetation();
    expect(w.tree[i]).toBeGreaterThan(before);
  });
});
