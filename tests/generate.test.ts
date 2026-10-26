import { describe, expect, it } from 'vitest';
import { BASE, H_MAX } from '../src/config';
import { generateTerrain } from '../src/sim/generate';
import { World } from '../src/sim/world';

describe('generateTerrain', () => {
  it('est déterministe', () => {
    const a = new World(64);
    const b = new World(64);
    generateTerrain(a, 123);
    generateTerrain(b, 123);
    expect(a.height).toEqual(b.height);
    expect(a.soil).toEqual(b.soil);
  });

  it('borne les altitudes et forme une île entourée de mer', () => {
    const w = new World(64);
    generateTerrain(w, 5);
    for (const h of w.height) {
      expect(h).toBeGreaterThanOrEqual(BASE);
      expect(h).toBeLessThanOrEqual(H_MAX);
    }
    for (let x = 0; x < w.n; x++) {
      expect(w.height[w.index(x, 0)]).toBeLessThan(w.seaLevel);
      expect(w.height[w.index(0, x)]).toBeLessThan(w.seaLevel);
    }
    expect(Math.max(...w.height)).toBeGreaterThan(w.seaLevel);
  });
});
