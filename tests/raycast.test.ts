import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/math';
import { normalize } from '../src/core/math';
import { raycastTerrain } from '../src/sim/raycast';
import { World } from '../src/sim/world';

describe('raycastTerrain', () => {
  it('touche un plateau à son altitude', () => {
    const w = new World(32);
    w.height.fill(2);
    const dir = normalize([0.5, -1, 0.3]);
    const origin: Vec3 = [5, 30, 5];
    const hit = raycastTerrain(w, origin, dir);
    expect(hit).not.toBeNull();
    expect(hit?.[1]).toBeCloseTo(2, 2);
  });

  it('retourne null hors de la grille ou vers le ciel', () => {
    const w = new World(16);
    expect(raycastTerrain(w, [-100, 50, -100], normalize([-1, -1, 0]))).toBeNull();
    expect(raycastTerrain(w, [8, 5, 8], [0, 1, 0])).toBeNull();
  });
});
