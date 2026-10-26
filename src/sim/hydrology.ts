import { clamp, smoothstep } from '../core/math';
import { soilDef } from './soils';
import type { World } from './world';

/** Voisinage D8 : est, sud-est, sud, sud-ouest, ouest, nord-ouest, nord, nord-est. */
export const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const D8_DZ = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const D8_DIST = D8_DX.map((dx, k) => Math.hypot(dx, D8_DZ[k]));

export const HYDRO = {
  /** Pluie reçue par pas ; majorée en altitude (effet orographique). */
  rain: 0.0038,
  rainHighlandBonus: 1.4,
  highlandAltitude: 8,
  /** Plafond de la part ruisselée par pas. */
  maxRunoff: 0.25,
  runoffSlopeScale: 0.05,
  /** Recharge par la nappe des cellules en bord d'eau. */
  shoreRecharge: 0.04,
  /** Seuils de surface drainée entre lesquels un cours d'eau apparaît puis s'élargit. */
  streamMin: 14,
  streamMax: 140,
} as const;

/**
 * Hydrologie en deux volets :
 * - `computeFlow` : réseau d'écoulement D8 et accumulation de flux → cours d'eau ;
 * - `step` : humidité du sol (pluie, ruissellement diffus vers l'aval, évaporation).
 */
export class Hydrology {
  private readonly order: Uint32Array;
  private readonly next: Float32Array;

  constructor(private readonly world: World) {
    this.order = new Uint32Array(world.cells);
    this.next = new Float32Array(world.cells);
  }

  computeFlow(): void {
    const w = this.world;
    const { n, height, flowDir, flowAcc, stream, soil, tree, grass, moisture } = w;

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        let best = 0;
        let dir = -1;
        for (let k = 0; k < 8; k++) {
          const xx = x + D8_DX[k];
          const zz = z + D8_DZ[k];
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          const drop = (height[i] - height[zz * n + xx]) / D8_DIST[k];
          if (drop > best) {
            best = drop;
            dir = k;
          }
        }
        flowDir[i] = dir;
        this.order[i] = i;
      }
    }

    // Des sommets vers les vallées : chaque cellule transmet son flux à sa voisine aval.
    this.order.sort((a, b) => height[b] - height[a]);
    flowAcc.fill(0);
    for (let k = 0; k < w.cells; k++) {
      const i = this.order[k];
      if (height[i] < w.seaLevel) continue;
      const cover = (1 - 0.45 * Math.min(1, tree[i])) * (1 - 0.2 * grass[i]);
      flowAcc[i] += soilDef(soil[i]).catchment * cover * (0.5 + moisture[i]);
      const d = flowDir[i];
      if (d >= 0) {
        const j = i + D8_DZ[d] * n + D8_DX[d];
        if (height[j] >= w.seaLevel) flowAcc[j] += flowAcc[i];
      }
    }
    for (let i = 0; i < w.cells; i++) {
      stream[i] = height[i] < w.seaLevel ? 0 : smoothstep(HYDRO.streamMin, HYDRO.streamMax, flowAcc[i]);
    }
  }

  step(): void {
    const w = this.world;
    const { n, height, moisture, soil, grass, tree, stream } = w;
    const next = this.next;
    next.set(moisture);

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        if (height[i] < w.seaLevel) {
          next[i] = 1;
          continue;
        }
        next[i] += HYDRO.rain * (height[i] > HYDRO.highlandAltitude ? HYDRO.rainHighlandBonus : 1);

        let slopeSum = 0;
        let nearWater = false;
        for (let k = 0; k < 8; k++) {
          const xx = x + D8_DX[k];
          const zz = z + D8_DZ[k];
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          const j = zz * n + xx;
          if (height[j] < w.seaLevel && k % 2 === 0) nearWater = true;
          const d = height[i] - height[j];
          if (d > 0) slopeSum += d / D8_DIST[k];
        }
        if (slopeSum > 0) {
          const out =
            moisture[i] *
            Math.min(HYDRO.maxRunoff, soilDef(soil[i]).runoff * slopeSum * HYDRO.runoffSlopeScale);
          next[i] -= out;
          for (let k = 0; k < 8; k++) {
            const xx = x + D8_DX[k];
            const zz = z + D8_DZ[k];
            if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
            const j = zz * n + xx;
            const d = height[i] - height[j];
            if (d > 0 && height[j] >= w.seaLevel) next[j] += (out * (d / D8_DIST[k])) / slopeSum;
          }
        }
        if (nearWater) next[i] += HYDRO.shoreRecharge * (1 - moisture[i]);
      }
    }

    for (let i = 0; i < w.cells; i++) {
      if (height[i] < w.seaLevel) {
        moisture[i] = 1;
        continue;
      }
      const shade = 1 - 0.3 * grass[i] - 0.25 * (tree[i] > 0.5 ? 1 : 0);
      let m = next[i] * (1 - soilDef(soil[i]).evaporation * shade);
      if (stream[i] > 0) m = Math.max(m, 0.9 * stream[i]);
      moisture[i] = clamp(m, 0, 1);
    }
  }
}
