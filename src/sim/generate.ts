import { BASE, H_MAX, SNOW_LINE } from '../config';
import { clamp, smoothstep } from '../core/math';
import { fbm, hash2 } from '../core/noise';
import { Soil } from './soils';
import type { World } from './world';

/**
 * Relief, sols et fertilité initiale d'une île. Fonction pure de la graine.
 * Ne plante que les arbres pionniers : la préhistoire (dans Simulation) fait le reste.
 */
export function generateTerrain(world: World, seed: number): void {
  const { n, height, soil, fertility } = world;
  const k = seed * 7;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const dx = x / (n - 1) - 0.5;
      const dz = z / (n - 1) - 0.5;
      const dist = Math.sqrt(dx * dx + dz * dz) * 2;
      const e = fbm(x * 0.03, z * 0.03, k + 1);
      const ridge = 1 - Math.abs(2 * fbm(x * 0.045, z * 0.045, k + 3, 4) - 1);
      const mask = 1 - smoothstep(0.5, 0.98, dist); // l'île plonge vers les bords
      const land = (e - 0.42) * 30 + ridge * ridge * ridge * 7 + 2;
      height[z * n + x] = clamp(-6 + (land + 6) * mask, BASE + 1.5, H_MAX - 1);
    }
  }
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const h = height[i];
      const clayNoise = fbm(x * 0.07, z * 0.07, k + 9, 3);
      soil[i] = h < 1.1 ? Soil.Sand : h > 12.5 ? Soil.Rock : clayNoise > 0.63 ? Soil.Clay : Soil.Humus;
      const f = clamp(fbm(x * 0.05, z * 0.05, k + 13, 4) * 1.6 - 0.35, 0, 1);
      fertility[i] = soil[i] === Soil.Rock ? 0 : soil[i] === Soil.Sand ? f * 0.4 : f;
      world.grass[i] = 0;
      world.tree[i] = 0;
      world.treeKind[i] = 0;
      world.field[i] = 0;
      world.crop[i] = 0;
      world.building[i] = 0;
      world.wear[i] = 0;
      world.moisture[i] = h < world.seaLevel ? 1 : 0.3;
    }
  }
}

/** Cellules où planter les arbres pionniers. */
export function pioneerCells(world: World, seed: number): number[] {
  const { n, height, fertility } = world;
  const out: number[] = [];
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      if (
        fertility[i] > 0.55 &&
        height[i] > world.seaLevel + 0.5 &&
        height[i] < SNOW_LINE &&
        hash2(x, z, seed * 7 + 21) < 0.02
      ) {
        out.push(i);
      }
    }
  }
  return out;
}
