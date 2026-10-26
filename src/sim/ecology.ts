import { SNOW_LINE } from '../config';
import { smoothstep } from '../core/math';
import type { Rng } from '../core/rng';
import { Soil, TreeKind, soilDef, type TreeKindId } from './soils';
import type { World } from './world';

export const ECO = {
  fertilityDiffusion: 0.05,
  fertilityDecay: 0.99975,
  alluvium: 0.0015,
  forestHumus: 0.0005,
  grassRate: 0.05,
  treeGrowth: 0.012,
  sproutBase: 0.00004,
  sproutPerNeighbour: 0.0035,
  saplingSize: 0.04,
  /** Croissance des céréales par pas, modulée par fertilité et humidité. */
  cropGrowth: 0.022,
  /** Fertilité prélevée par les céréales à chaque pas. */
  cropUptake: 0.0008,
} as const;

/** Fertilité, herbe et forêts. Les tirages passent par le Rng de la simulation. */
export class Ecology {
  private readonly scratch: Float32Array;

  constructor(
    private readonly world: World,
    private readonly rng: Rng,
  ) {
    this.scratch = new Float32Array(world.cells);
  }

  diffuseFertility(): void {
    const { n, fertility } = this.world;
    const out = this.scratch;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        let s = 0;
        let c = 0;
        if (x > 0) {
          s += fertility[i - 1];
          c++;
        }
        if (x < n - 1) {
          s += fertility[i + 1];
          c++;
        }
        if (z > 0) {
          s += fertility[i - n];
          c++;
        }
        if (z < n - 1) {
          s += fertility[i + n];
          c++;
        }
        out[i] = fertility[i] + ECO.fertilityDiffusion * (s / c - fertility[i]);
      }
    }
    fertility.set(out);
  }

  stepVegetation(): void {
    const w = this.world;
    const { n, height, soil, fertility, grass, tree, moisture, stream, field, crop, building } = w;

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        const h = height[i];
        if (h < w.seaLevel + 0.05) {
          grass[i] = 0;
          tree[i] = 0;
          field[i] = 0;
          crop[i] = 0;
          continue;
        }
        const def = soilDef(soil[i]);
        const wet = smoothstep(0.08, 0.4, moisture[i]);
        if (field[i]) {
          // Champ : la terre retournée ne porte que les céréales semées.
          grass[i] = 0;
          tree[i] = 0;
          if (crop[i] > 0 && crop[i] < 1) {
            crop[i] = Math.min(1, crop[i] + ECO.cropGrowth * (0.3 + fertility[i]) * (0.4 + def.grass) * wet);
            fertility[i] = Math.max(0, fertility[i] - ECO.cropUptake);
          }
          continue;
        }
        let target = Math.min(1, fertility[i] * def.grass * 1.8 * wet);
        if (h > SNOW_LINE) target *= 0.15;
        grass[i] += (target - grass[i]) * ECO.grassRate;
        fertility[i] *= ECO.fertilityDecay;
        if (stream[i] > 0) fertility[i] = Math.min(1, fertility[i] + ECO.alluvium * stream[i]);

        if (tree[i] > 0) {
          if (def.trees === 0 || h > SNOW_LINE + 1) {
            tree[i] = 0;
            continue;
          }
          const water = 0.3 + 0.7 * smoothstep(0.12, 0.45, moisture[i]);
          tree[i] = Math.min(1, tree[i] + ECO.treeGrowth * (0.35 + fertility[i]) * def.trees * water);
          if (tree[i] > 0.6) fertility[i] = Math.min(1, fertility[i] + ECO.forestHumus);
        } else if (
          grass[i] > 0.45 &&
          h < SNOW_LINE &&
          def.trees > 0 &&
          !building[i] &&
          w.orthogonalFree(x, z)
        ) {
          const p =
            (ECO.sproutBase + ECO.sproutPerNeighbour * this.matureNeighbours(x, z)) *
            fertility[i] *
            def.trees *
            smoothstep(0.15, 0.45, moisture[i]);
          if (this.rng.next() < p) this.plant(i);
        }
      }
    }
  }

  /** Plante un jeune arbre dont l'espèce dépend du terrain. */
  plant(i: number, size: number = ECO.saplingSize): void {
    this.world.tree[i] = size;
    this.world.treeKind[i] = this.pickKind(i);
  }

  pickKind(i: number): TreeKindId {
    const h = this.world.height[i];
    const s = this.world.soil[i];
    const r = this.rng.next();
    if (h > 9.5) return r < 0.85 ? TreeKind.Conifer : TreeKind.Bush;
    if (s === Soil.Sand) return r < 0.5 ? TreeKind.Conifer : TreeKind.Bush;
    if (s === Soil.Clay) return r < 0.35 ? TreeKind.Bush : TreeKind.Broadleaf;
    if (r < 0.12) return TreeKind.Bush;
    return h > 6 && r < 0.45 ? TreeKind.Conifer : TreeKind.Broadleaf;
  }

  /** Arbres matures dans un rayon de 2 cellules : source de graines. */
  private matureNeighbours(x: number, z: number): number {
    const { n, tree } = this.world;
    let count = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const zz = z + dz;
        if (xx >= 0 && xx < n && zz >= 0 && zz < n && tree[zz * n + xx] > 0.7) count++;
      }
    }
    return count;
  }
}
