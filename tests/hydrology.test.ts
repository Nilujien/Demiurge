import { describe, expect, it } from 'vitest';
import { Hydrology } from '../src/sim/hydrology';
import { Soil } from '../src/sim/soils';
import { World } from '../src/sim/world';

/** Plan incliné qui descend vers l'ouest (x = 0), avec la mer sur la colonne x = 0. */
function slope(n = 16): World {
  const w = new World(n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = w.index(x, z);
      w.height[i] = x === 0 ? -1 : x * 0.5;
      w.soil[i] = Soil.Humus;
      w.moisture[i] = 0.3;
    }
  }
  return w;
}

describe('Hydrology.computeFlow', () => {
  it('fait couler chaque cellule vers la voisine la plus basse', () => {
    const w = slope();
    new Hydrology(w).computeFlow();
    for (let z = 1; z < w.n - 1; z++) {
      for (let x = 1; x < w.n; x++) expect(w.flowDir[w.index(x, z)]).toBe(4); // ouest
    }
  });

  it("accumule le flux vers l'aval", () => {
    const w = slope();
    new Hydrology(w).computeFlow();
    const z = 8;
    for (let x = 2; x < w.n; x++) {
      expect(w.flowAcc[w.index(x - 1, z)]).toBeGreaterThan(w.flowAcc[w.index(x, z)]);
    }
  });

  it("marque une cuvette sans direction d'écoulement", () => {
    const w = slope();
    w.height[w.index(8, 8)] = -0.5 + 0.1; // creux au-dessus de la mer, plus bas que ses voisins
    for (let k = 0; k < w.cells; k++) if (k !== w.index(8, 8)) w.height[k] = Math.max(w.height[k], 0.2);
    new Hydrology(w).computeFlow();
    expect(w.flowDir[w.index(8, 8)]).toBe(-1);
  });
});

describe('Hydrology.step', () => {
  it("draine l'humidité des pentes vers le bas", () => {
    const w = slope();
    const h = new Hydrology(w);
    h.computeFlow();
    for (let t = 0; t < 200; t++) h.step();
    const z = 8;
    expect(w.moisture[w.index(1, z)]).toBeGreaterThan(w.moisture[w.index(w.n - 1, z)]);
  });

  it('garde les cellules immergées saturées et toutes les valeurs dans [0, 1]', () => {
    const w = slope();
    const h = new Hydrology(w);
    for (let t = 0; t < 50; t++) h.step();
    expect(w.moisture[w.index(0, 5)]).toBe(1);
    for (const m of w.moisture) {
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});
